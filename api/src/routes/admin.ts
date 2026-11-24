import { Router } from "express";
import { z } from "zod";
import MetalRequest, { REQUEST_STATUSES } from "../models/requestModel.js";
import User from "../models/userModel.js";
import { decideRequest } from "../services/ledger.js";
import { reconcile } from "../services/reconciliation.js";
import { closeAccount } from "../services/accounts.js";
import { mgToGrams } from "../lib/grams.js";
import { requestView } from "../lib/views.js";
import { authorizeRoles, isAuthenticatedUser } from "../middlewares/auth.js";
import { METALS } from "../models/metals.js";

const router = Router();
router.use(isAuthenticatedUser, authorizeRoles("admin"));

const queueQuery = z.object({
  status: z.enum(REQUEST_STATUSES).default("pending"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// The approval queue: oldest first, so nothing waits behind newer requests.
router.get("/requests", async (req, res) => {
  const { status, limit } = queueQuery.parse(req.query);
  const rows = await MetalRequest.find({ status })
    .sort(status === "pending" ? { createdAt: 1 } : { decidedAt: -1 })
    .limit(limit)
    .lean();

  const users = await User.find({ _id: { $in: rows.map((r) => r.user) } }, "name email").lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));

  res.json({
    success: true,
    data: rows.map((row) => requestView(row, byId.get(String(row.user)) ?? null)),
  });
});

const rejectBody = z.object({ reason: z.string().trim().min(1).max(500) });

router.post("/requests/:id/approve", async (req, res) => {
  const request = await decideRequest(req.user!.id, req.params.id, "approve");
  res.json({ success: true, data: requestView(request) });
});

router.post("/requests/:id/reject", async (req, res) => {
  const { reason } = rejectBody.parse(req.body ?? {});
  const request = await decideRequest(req.user!.id, req.params.id, "reject", reason);
  res.json({ success: true, data: requestView(request) });
});

router.get("/reconciliation", async (_req, res) => {
  const report = await reconcile();
  res.json({
    success: true,
    data: {
      ok: report.ok,
      checkedAt: report.checkedAt.toISOString(),
      balancesChecked: report.balancesChecked,
      issues: report.issues,
      liabilities: METALS.map((metal) => ({ metal, total: mgToGrams(report.liabilitiesMg[metal]) })),
    },
  });
});

router.delete("/users/:id", async (req, res) => {
  await closeAccount(req.params.id);
  res.json({ success: true, message: "Account closed" });
});

export default router;
