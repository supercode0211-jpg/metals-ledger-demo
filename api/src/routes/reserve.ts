import { Router } from "express";
import Balance from "../models/balanceModel.js";
import { METALS, type Metal } from "../models/metals.js";
import { mgToGrams } from "../lib/grams.js";
import { isAuthenticatedUser } from "../middlewares/auth.js";

const router = Router();

/**
 * Proof of reserve, honest placeholder version.
 *
 * The liabilities side is real: what all holders own, per metal, straight from
 * the balances. The reserves side stays null until a custody/reserve provider
 * is picked, and the status says so. No ratio and no "verified" until there is
 * something to compare. A ratio is only meaningful per metal anyway.
 */
router.get("/proof-of-reserve", isAuthenticatedUser, async (_req, res) => {
  const totals = await Balance.aggregate<{ _id: Metal; totalMg: number }>([
    { $group: { _id: "$metal", totalMg: { $sum: { $add: ["$availableMg", "$heldMg"] } } } },
  ]);

  res.json({
    success: true,
    data: {
      status: "awaiting_provider",
      asOf: new Date().toISOString(),
      metals: METALS.map((metal) => ({
        metal,
        liabilities: mgToGrams(totals.find((t) => t._id === metal)?.totalMg ?? 0),
        reserves: null,
        coverage: null,
      })),
    },
  });
});

export default router;
