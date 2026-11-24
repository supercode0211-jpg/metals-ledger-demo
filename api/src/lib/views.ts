import type { IMetalRequest } from "../models/requestModel.js";
import type { ILedgerEntry } from "../models/ledgerEntryModel.js";
import type { IUser } from "../models/userModel.js";
import type { BalanceRow } from "../services/ledger.js";
import { mgToGrams } from "./grams.js";

// Response shapes. Gram amounts go out as strings ("12.500") next to the exact
// milligram integers, so the UI never has to do money maths on floats.

export const userView = (user: Pick<IUser, "_id" | "name" | "email" | "role">) => ({
  id: String(user._id),
  name: user.name,
  email: user.email,
  role: user.role,
});

export const balanceView = (row: BalanceRow) => {
  const totalMg = row.availableMg + row.heldMg;
  return {
    metal: row.metal,
    available: mgToGrams(row.availableMg),
    held: mgToGrams(row.heldMg),
    total: mgToGrams(totalMg),
    availableMg: row.availableMg,
    heldMg: row.heldMg,
    totalMg,
  };
};

export const requestView = (
  request: IMetalRequest,
  owner?: Pick<IUser, "_id" | "name" | "email"> | null
) => ({
  id: String(request._id),
  type: request.type,
  metal: request.metal,
  grams: mgToGrams(request.amountMg),
  amountMg: request.amountMg,
  status: request.status,
  note: request.note ?? null,
  reason: request.reason ?? null,
  createdAt: request.createdAt.toISOString(),
  decidedAt: request.decidedAt?.toISOString() ?? null,
  ...(owner !== undefined
    ? { user: owner ? { id: String(owner._id), name: owner.name, email: owner.email } : null }
    : {}),
});

export const ledgerView = (entry: ILedgerEntry) => ({
  id: String(entry._id),
  requestId: String(entry.request),
  kind: entry.kind,
  metal: entry.metal,
  available: mgToGrams(entry.availableDeltaMg),
  held: mgToGrams(entry.heldDeltaMg),
  availableAfter: mgToGrams(entry.availableAfterMg),
  heldAfter: mgToGrams(entry.heldAfterMg),
  createdAt: entry.createdAt.toISOString(),
});
