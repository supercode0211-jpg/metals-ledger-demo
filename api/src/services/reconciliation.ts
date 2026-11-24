import Balance from "../models/balanceModel.js";
import MetalRequest from "../models/requestModel.js";
import LedgerEntry from "../models/ledgerEntryModel.js";
import { METALS, type Metal } from "../models/metals.js";
import { inTransaction } from "./transaction.js";

export type CheckName = "ledger_available" | "ledger_held" | "open_requests_held" | "missing_balance";

export interface Issue {
  user: string;
  metal: Metal;
  check: CheckName;
  expectedMg: number;
  actualMg: number;
}

export interface ReconciliationReport {
  ok: boolean;
  checkedAt: Date;
  balancesChecked: number;
  issues: Issue[];
  // Sum of every holder's total per metal: what we owe in metal. This is the
  // liabilities side of proof of reserve.
  liabilitiesMg: Record<Metal, number>;
}

interface Sums {
  _id: { user: unknown; metal: Metal };
  available: number;
  held: number;
}

/**
 * Re-derives every balance from the ledger and from the open requests, and
 * reports any difference. It never corrects anything: a mismatch means
 * something wrote outside the ledger service and a person should look at it.
 *
 * Everything is read from one snapshot, so a request being approved while
 * this runs can't show up as a false mismatch.
 */
export async function reconcile(): Promise<ReconciliationReport> {
  return inTransaction(async (session) => {
    const balances = await Balance.find({}, null, { session }).lean();

    const ledger = await LedgerEntry.aggregate<Sums>([
      {
        $group: {
          _id: { user: "$user", metal: "$metal" },
          available: { $sum: "$availableDeltaMg" },
          held: { $sum: "$heldDeltaMg" },
        },
      },
    ]).session(session);

    const openHolds = await MetalRequest.aggregate<Sums>([
      { $match: { status: "pending", type: { $in: ["withdrawal", "redemption"] } } },
      {
        $group: {
          _id: { user: "$user", metal: "$metal" },
          available: { $sum: 0 },
          held: { $sum: "$amountMg" },
        },
      },
    ]).session(session);

    const key = (user: unknown, metal: string) => `${String(user)}:${metal}`;
    const ledgerByKey = new Map(ledger.map((s) => [key(s._id.user, s._id.metal), s]));
    const holdsByKey = new Map(openHolds.map((s) => [key(s._id.user, s._id.metal), s]));

    const issues: Issue[] = [];
    const liabilitiesMg = Object.fromEntries(METALS.map((m) => [m, 0])) as Record<Metal, number>;
    const seen = new Set<string>();

    for (const b of balances) {
      const k = key(b.user, b.metal);
      seen.add(k);
      liabilitiesMg[b.metal] += b.availableMg + b.heldMg;

      const fromLedger = ledgerByKey.get(k);
      const user = String(b.user);
      if ((fromLedger?.available ?? 0) !== b.availableMg) {
        issues.push({ user, metal: b.metal, check: "ledger_available", expectedMg: fromLedger?.available ?? 0, actualMg: b.availableMg });
      }
      if ((fromLedger?.held ?? 0) !== b.heldMg) {
        issues.push({ user, metal: b.metal, check: "ledger_held", expectedMg: fromLedger?.held ?? 0, actualMg: b.heldMg });
      }
      const held = holdsByKey.get(k)?.held ?? 0;
      if (held !== b.heldMg) {
        issues.push({ user, metal: b.metal, check: "open_requests_held", expectedMg: held, actualMg: b.heldMg });
      }
    }

    // Ledger rows or open holds for a balance that doesn't exist at all.
    for (const [k, s] of [...ledgerByKey, ...holdsByKey]) {
      if (seen.has(k) || (s.available === 0 && s.held === 0)) continue;
      seen.add(k);
      issues.push({
        user: String(s._id.user),
        metal: s._id.metal,
        check: "missing_balance",
        expectedMg: s.available + s.held,
        actualMg: 0,
      });
    }

    return {
      ok: issues.length === 0,
      checkedAt: new Date(),
      balancesChecked: balances.length,
      issues,
      liabilitiesMg,
    };
  });
}
