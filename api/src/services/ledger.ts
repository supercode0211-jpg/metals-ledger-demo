import { Types, type ClientSession, type HydratedDocument } from "mongoose";
import Balance, { type IBalance } from "../models/balanceModel.js";
import MetalRequest, { type IMetalRequest, type RequestType } from "../models/requestModel.js";
import LedgerEntry, { type EntryKind } from "../models/ledgerEntryModel.js";
import { METALS, type Metal } from "../models/metals.js";
import { AppError, isDuplicateKeyError } from "../lib/errors.js";
import { inTransaction } from "./transaction.js";

/*
 * Every change to a balance goes through this file, and every one of them is
 * a balance update plus a ledger entry committed in the same transaction.
 *
 *                      available   held     ledger entry
 *   deposit created        -         -       -
 *   deposit approved     +amount     -       deposit_credit
 *   deposit rejected       -         -       -
 *   withdrawal created   -amount   +amount   hold
 *   withdrawal approved    -       -amount   settle
 *   withdrawal rejected  +amount   -amount   release
 *
 * Redemptions follow the withdrawal rows.
 */

type Id = Types.ObjectId | string;
type RequestDoc = HydratedDocument<IMetalRequest>;

export interface NewRequest {
  type: RequestType;
  metal: Metal;
  amountMg: number;
  note?: string;
}

export interface CreateResult {
  request: RequestDoc;
  // true when this was a retry of a request we already had
  replayed: boolean;
}

const takesFromBalance = (type: RequestType) => type !== "deposit";

export async function createRequest(
  userId: Id,
  input: NewRequest,
  idempotencyKey: string
): Promise<CreateResult> {
  if (!Number.isSafeInteger(input.amountMg) || input.amountMg <= 0) {
    throw new AppError(400, "INVALID_AMOUNT", "Amount must be more than 0 g");
  }
  const fingerprint = `${input.type}:${input.metal}:${input.amountMg}`;

  const previous = await MetalRequest.findOne({ user: userId, idempotencyKey });
  if (previous) return replay(previous, fingerprint);

  try {
    const request = await inTransaction(async (session) => {
      const [created] = await MetalRequest.create(
        [{ user: userId, ...input, status: "pending", idempotencyKey, fingerprint }],
        { session }
      );
      const request = created!;

      if (takesFromBalance(request.type)) {
        // The check and the move are one conditional update, so two requests
        // racing for the same grams can't both pass.
        const balance = await Balance.findOneAndUpdate(
          { user: request.user, metal: request.metal, availableMg: { $gte: request.amountMg } },
          { $inc: { availableMg: -request.amountMg, heldMg: request.amountMg } },
          { session, returnDocument: "after" }
        );
        if (!balance) {
          throw new AppError(409, "INSUFFICIENT_BALANCE", `Not enough ${request.metal} available`);
        }
        await book(session, request, "hold", -request.amountMg, request.amountMg, balance, request.user);
      }

      return request;
    });
    return { request, replayed: false };
  } catch (error) {
    // Same key sent twice at the same moment: the second insert loses on the
    // unique index and the caller gets the request that won.
    if (isDuplicateKeyError(error)) {
      const winner = await MetalRequest.findOne({ user: userId, idempotencyKey });
      if (winner) return replay(winner, fingerprint);
    }
    throw error;
  }
}

function replay(existing: RequestDoc, fingerprint: string): CreateResult {
  if (existing.fingerprint !== fingerprint) {
    throw new AppError(
      409,
      "IDEMPOTENCY_KEY_REUSED",
      "This Idempotency-Key was already used for a different request"
    );
  }
  return { request: existing, replayed: true };
}

export type Decision = "approve" | "reject";

export async function decideRequest(
  adminId: Id,
  requestId: string,
  decision: Decision,
  reason?: string
): Promise<RequestDoc> {
  if (!Types.ObjectId.isValid(requestId)) {
    throw new AppError(404, "REQUEST_NOT_FOUND", "Request not found");
  }

  return inTransaction(async (session) => {
    // Only a pending request matches, so a double click or two admins at once
    // can't settle the same request twice.
    const request = await MetalRequest.findOneAndUpdate(
      { _id: requestId, status: "pending", user: { $ne: adminId } },
      {
        $set: {
          status: decision === "approve" ? "completed" : "rejected",
          decidedBy: adminId,
          decidedAt: new Date(),
          ...(reason ? { reason } : {}),
        },
      },
      { session, returnDocument: "after" }
    );
    if (!request) {
      throw await whyNotDecidable(requestId, adminId, session);
    }

    const amount = request.amountMg;
    const owner = { user: request.user, metal: request.metal };

    if (request.type === "deposit") {
      if (decision === "approve") {
        const balance = await Balance.findOneAndUpdate(
          owner,
          { $inc: { availableMg: amount }, $setOnInsert: { heldMg: 0 } },
          { session, upsert: true, setDefaultsOnInsert: false, returnDocument: "after" }
        );
        await book(session, request, "deposit_credit", amount, 0, balance!, adminId);
      }
      return request;
    }

    // Withdrawal or redemption: the amount is already sitting in held.
    const balance = await Balance.findOneAndUpdate(
      { ...owner, heldMg: { $gte: amount } },
      decision === "approve"
        ? { $inc: { heldMg: -amount } }
        : { $inc: { heldMg: -amount, availableMg: amount } },
      { session, returnDocument: "after" }
    );
    if (!balance) {
      // Can't happen unless something wrote to balances outside this file.
      // Abort rather than settle against a hold that isn't there.
      throw new AppError(500, "HOLD_MISSING", "The hold for this request is missing; nothing was changed");
    }

    if (decision === "approve") {
      await book(session, request, "settle", 0, -amount, balance, adminId);
    } else {
      await book(session, request, "release", amount, -amount, balance, adminId);
    }
    return request;
  });
}

async function whyNotDecidable(requestId: string, adminId: Id, session: ClientSession) {
  const current = await MetalRequest.findById(requestId).session(session);
  if (!current) {
    return new AppError(404, "REQUEST_NOT_FOUND", "Request not found");
  }
  if (current.user.equals(adminId)) {
    return new AppError(403, "OWN_REQUEST", "Admins can't decide their own requests");
  }
  return new AppError(409, "ALREADY_DECIDED", `Request is already ${current.status}`);
}

async function book(
  session: ClientSession,
  request: RequestDoc,
  kind: EntryKind,
  availableDeltaMg: number,
  heldDeltaMg: number,
  balanceAfter: Pick<IBalance, "availableMg" | "heldMg">,
  actor: Id
): Promise<void> {
  await LedgerEntry.create(
    [
      {
        user: request.user,
        metal: request.metal,
        request: request._id,
        kind,
        availableDeltaMg,
        heldDeltaMg,
        availableAfterMg: balanceAfter.availableMg,
        heldAfterMg: balanceAfter.heldMg,
        actor,
      },
    ],
    { session }
  );
}

export interface BalanceRow {
  metal: Metal;
  availableMg: number;
  heldMg: number;
}

/** All three metals, zero for any the user never held. */
export async function getBalances(userId: Id): Promise<BalanceRow[]> {
  const rows = await Balance.find({ user: userId }).lean();
  return METALS.map((metal) => {
    const row = rows.find((r) => r.metal === metal);
    return { metal, availableMg: row?.availableMg ?? 0, heldMg: row?.heldMg ?? 0 };
  });
}
