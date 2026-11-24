import { Router } from "express";
import { z } from "zod";
import MetalRequest, { REQUEST_STATUSES, REQUEST_TYPES } from "../models/requestModel.js";
import LedgerEntry from "../models/ledgerEntryModel.js";
import { METALS } from "../models/metals.js";
import { createRequest, getBalances } from "../services/ledger.js";
import { GRAMS_PATTERN, gramsToMg } from "../lib/grams.js";
import { balanceView, ledgerView, requestView } from "../lib/views.js";
import { isAuthenticatedUser } from "../middlewares/auth.js";
import { parsePaging } from "./paging.js";

// Everything a holder sees about their own metal.
const router = Router();
router.use(isAuthenticatedUser);

router.get("/holdings", async (req, res) => {
  const balances = await getBalances(req.user!.id);
  res.json({ success: true, data: balances.map(balanceView) });
});

const idempotencyKey = z
  .string({ error: "Idempotency-Key header is required" })
  .regex(/^[A-Za-z0-9_-]{8,100}$/, "Idempotency-Key must be 8-100 letters, digits, - or _");

const newRequestBody = z.strictObject({
  type: z.enum(REQUEST_TYPES),
  metal: z.enum(METALS),
  grams: z.string().regex(GRAMS_PATTERN, 'grams must be a string like "12.5", at most 3 decimals'),
  note: z.string().trim().max(500).optional(),
});

router.post("/requests", async (req, res) => {
  const key = idempotencyKey.parse(req.get("Idempotency-Key"));
  const body = newRequestBody.parse(req.body);

  const { request, replayed } = await createRequest(
    req.user!.id,
    { type: body.type, metal: body.metal, amountMg: gramsToMg(body.grams), note: body.note },
    key
  );
  res.status(replayed ? 200 : 201).json({ success: true, replayed, data: requestView(request) });
});

const historyQuery = z.object({
  status: z.enum(REQUEST_STATUSES).optional(),
  type: z.enum(REQUEST_TYPES).optional(),
});

router.get("/requests", async (req, res) => {
  const { limit, idFilter } = parsePaging(req.query);
  const { status, type } = historyQuery.parse(req.query);

  const rows = await MetalRequest.find({
    user: req.user!.id,
    ...idFilter,
    ...(status ? { status } : {}),
    ...(type ? { type } : {}),
  })
    .sort({ _id: -1 })
    .limit(limit)
    .lean();

  res.json({ success: true, data: rows.map((row) => requestView(row)) });
});

router.get("/ledger", async (req, res) => {
  const { limit, idFilter } = parsePaging(req.query);
  const rows = await LedgerEntry.find({ user: req.user!.id, ...idFilter })
    .sort({ _id: -1 })
    .limit(limit)
    .lean();

  res.json({ success: true, data: rows.map(ledgerView) });
});

export default router;
