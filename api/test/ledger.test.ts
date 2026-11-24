import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Types } from "mongoose";
import Balance from "../src/models/balanceModel.js";
import MetalRequest from "../src/models/requestModel.js";
import LedgerEntry from "../src/models/ledgerEntryModel.js";
import { createRequest, decideRequest } from "../src/services/ledger.js";
import { reconcile } from "../src/services/reconciliation.js";
import { closeAccount } from "../src/services/accounts.js";
import { METALS } from "../src/models/metals.js";
import { balanceOf, clearDatabase, fund, makeUser, newKey, startDatabase, stopDatabase } from "./helpers.js";

beforeAll(startDatabase);
afterAll(stopDatabase);

let admin: string;
let holder: string;

beforeEach(async () => {
  await clearDatabase();
  admin = await makeUser("admin");
  holder = await makeUser();
});

const withdraw = (grams: number, key = newKey(), type: "withdrawal" | "redemption" = "withdrawal") =>
  createRequest(holder, { type, metal: "gold", amountMg: grams * 1000 }, key);

const kindsFor = async (requestId: Types.ObjectId) =>
  (await LedgerEntry.find({ request: requestId }).sort({ _id: 1 }).lean()).map((e) => e.kind);

describe("deposits", () => {
  it("stay pending and credit nothing until an admin approves", async () => {
    const { request } = await createRequest(holder, { type: "deposit", metal: "gold", amountMg: 50_000 }, newKey());

    expect(request.status).toBe("pending");
    expect(await balanceOf(holder, "gold")).toMatchObject({ availableMg: 0, heldMg: 0 });

    await decideRequest(admin, String(request._id), "approve");

    expect(await balanceOf(holder, "gold")).toMatchObject({ availableMg: 50_000, heldMg: 0 });
    expect(await kindsFor(request._id)).toEqual(["deposit_credit"]);
  });

  it("move nothing when rejected", async () => {
    const { request } = await createRequest(holder, { type: "deposit", metal: "gold", amountMg: 50_000 }, newKey());
    const rejected = await decideRequest(admin, String(request._id), "reject", "No matching transfer");

    expect(rejected).toMatchObject({ status: "rejected", reason: "No matching transfer" });
    expect(await balanceOf(holder, "gold")).toMatchObject({ availableMg: 0, heldMg: 0 });
    expect(await kindsFor(request._id)).toEqual([]);
  });
});

describe("withdrawals", () => {
  beforeEach(() => fund(holder, admin, "gold", "100"));

  it("hold the full amount as soon as they are created", async () => {
    const { request } = await withdraw(30);

    expect(request.status).toBe("pending");
    expect(await balanceOf(holder, "gold")).toMatchObject({ availableMg: 70_000, heldMg: 30_000 });
    expect(await kindsFor(request._id)).toEqual(["hold"]);
  });

  it("settle on approval: the held amount leaves, available is untouched", async () => {
    const { request } = await withdraw(30);
    await decideRequest(admin, String(request._id), "approve");

    expect(await balanceOf(holder, "gold")).toMatchObject({ availableMg: 70_000, heldMg: 0 });
    expect(await kindsFor(request._id)).toEqual(["hold", "settle"]);
  });

  it("release on rejection: available comes back", async () => {
    const { request } = await withdraw(30);
    await decideRequest(admin, String(request._id), "reject", "Bank details don't match");

    expect(await balanceOf(holder, "gold")).toMatchObject({ availableMg: 100_000, heldMg: 0 });
    expect(await kindsFor(request._id)).toEqual(["hold", "release"]);
  });

  it("can't ask for grams that are already held", async () => {
    await withdraw(60);

    await expect(withdraw(50)).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE", statusCode: 409 });

    // The refused request was rolled back with its hold: nothing half-written.
    expect(await balanceOf(holder, "gold")).toMatchObject({ availableMg: 40_000, heldMg: 60_000 });
    expect(await MetalRequest.countDocuments({ type: "withdrawal" })).toBe(1);
  });

  it("works the same way for redemptions", async () => {
    const { request } = await withdraw(25, newKey(), "redemption");
    expect(await balanceOf(holder, "gold")).toMatchObject({ availableMg: 75_000, heldMg: 25_000 });

    await decideRequest(admin, String(request._id), "approve");
    expect(await balanceOf(holder, "gold")).toMatchObject({ availableMg: 75_000, heldMg: 0 });
  });

  it("never overdraw, even when they all arrive at once", async () => {
    const results = await Promise.allSettled(Array.from({ length: 10 }, () => withdraw(30)));

    const accepted = results.filter((r) => r.status === "fulfilled");
    expect(accepted).toHaveLength(3);
    expect(await balanceOf(holder, "gold")).toMatchObject({ availableMg: 10_000, heldMg: 90_000 });
  });
});

describe("decisions", () => {
  beforeEach(() => fund(holder, admin, "gold", "100"));

  it("can be made once", async () => {
    const { request } = await withdraw(30);
    await decideRequest(admin, String(request._id), "approve");

    await expect(decideRequest(admin, String(request._id), "approve")).rejects.toMatchObject({ code: "ALREADY_DECIDED" });
    await expect(decideRequest(admin, String(request._id), "reject", "late")).rejects.toMatchObject({ code: "ALREADY_DECIDED" });
    expect(await balanceOf(holder, "gold")).toMatchObject({ availableMg: 70_000, heldMg: 0 });
  });

  it("settle exactly once when two admins click at the same time", async () => {
    const secondAdmin = await makeUser("admin");
    const { request } = await withdraw(30);

    const results = await Promise.allSettled([
      decideRequest(admin, String(request._id), "approve"),
      decideRequest(secondAdmin, String(request._id), "reject", "duplicate"),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const kinds = await kindsFor(request._id);
    expect(kinds).toHaveLength(2);
    expect(["settle", "release"]).toContain(kinds[1]);
    expect((await reconcile()).ok).toBe(true);
  });

  it("can't be made by an admin on their own request", async () => {
    await fund(admin, await makeUser("admin"), "gold", "10");
    const { request } = await createRequest(admin, { type: "withdrawal", metal: "gold", amountMg: 5_000 }, newKey());

    await expect(decideRequest(admin, String(request._id), "approve")).rejects.toMatchObject({ code: "OWN_REQUEST" });
  });

  it("404 for a request that doesn't exist", async () => {
    await expect(decideRequest(admin, "64b000000000000000000000", "approve")).rejects.toMatchObject({ code: "REQUEST_NOT_FOUND" });
    await expect(decideRequest(admin, "not-an-id", "approve")).rejects.toMatchObject({ code: "REQUEST_NOT_FOUND" });
  });
});

describe("idempotency keys", () => {
  beforeEach(() => fund(holder, admin, "gold", "100"));

  it("turn a retried call into the same request, held once", async () => {
    const key = newKey();
    const first = await withdraw(30, key);
    const retry = await withdraw(30, key);

    expect(retry.replayed).toBe(true);
    expect(String(retry.request._id)).toBe(String(first.request._id));
    expect(await balanceOf(holder, "gold")).toMatchObject({ availableMg: 70_000, heldMg: 30_000 });
  });

  it("refuse a key reused for a different request", async () => {
    const key = newKey();
    await withdraw(30, key);
    await expect(withdraw(31, key)).rejects.toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("create one request when the same call arrives twice at once", async () => {
    const key = newKey();
    const [a, b] = await Promise.all([withdraw(30, key), withdraw(30, key)]);

    expect(String(a.request._id)).toBe(String(b.request._id));
    expect(await MetalRequest.countDocuments({ type: "withdrawal" })).toBe(1);
    expect(await balanceOf(holder, "gold")).toMatchObject({ availableMg: 70_000, heldMg: 30_000 });
  });
});

describe("safety nets", () => {
  it("ledger entries can't be edited or deleted", async () => {
    await fund(holder, admin, "gold", "10");

    await expect(LedgerEntry.updateOne({}, { $set: { availableDeltaMg: 999 } })).rejects.toThrow(/append-only/);
    await expect(LedgerEntry.deleteMany({})).rejects.toThrow(/append-only/);

    const entry = await LedgerEntry.findOne();
    entry!.availableDeltaMg = 999;
    await expect(entry!.save()).rejects.toThrow(/append-only/);
  });

  it("MongoDB itself refuses a negative or fractional balance", async () => {
    await fund(holder, admin, "gold", "10");

    await expect(Balance.collection.updateOne({}, { $set: { availableMg: -1 } })).rejects.toMatchObject({ code: 121 });
    await expect(Balance.collection.updateOne({}, { $set: { heldMg: 0.5 } })).rejects.toMatchObject({ code: 121 });
  });

  it("accounts holding metal can't be closed", async () => {
    await fund(holder, admin, "gold", "10");
    await expect(closeAccount(holder)).rejects.toMatchObject({ code: "ACCOUNT_NOT_EMPTY" });

    const empty = await makeUser();
    await expect(closeAccount(empty)).resolves.toBeUndefined();
  });
});

describe("reconciliation", () => {
  it("stays clean through a long random run, and catches a tampered balance", async () => {
    const holders = [holder, await makeUser(), await makeUser()];

    // Small deterministic PRNG so a failure can be replayed.
    let seed = 42;
    const random = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
    const pick = <T,>(items: readonly T[]) => items[Math.floor(random() * items.length)]!;

    for (let i = 0; i < 150; i++) {
      const roll = random();
      const user = pick(holders);
      const metal = pick(METALS);
      const amountMg = 1 + Math.floor(random() * 50_000);

      if (roll < 0.4) {
        await createRequest(user, { type: "deposit", metal, amountMg }, newKey());
      } else if (roll < 0.7) {
        const type = random() < 0.5 ? "withdrawal" : "redemption";
        await createRequest(user, { type, metal, amountMg }, newKey()).catch((error) => {
          if (error.code !== "INSUFFICIENT_BALANCE") throw error;
        });
      } else {
        const pending = await MetalRequest.find({ status: "pending" }).lean();
        if (pending.length > 0) {
          await decideRequest(admin, String(pick(pending)._id), random() < 0.75 ? "approve" : "reject", "random");
        }
      }
    }

    const clean = await reconcile();
    expect(clean.issues).toEqual([]);
    expect(clean.balancesChecked).toBeGreaterThan(0);

    // Someone "fixes" a balance by hand, outside the ledger.
    await Balance.collection.updateOne({ user: (await Balance.findOne())!.user }, { $inc: { availableMg: 1 } });

    const report = await reconcile();
    expect(report.ok).toBe(false);
    expect(report.issues[0]).toMatchObject({ check: "ledger_available" });
    expect(report.issues[0]!.actualMg - report.issues[0]!.expectedMg).toBe(1);
  });
});
