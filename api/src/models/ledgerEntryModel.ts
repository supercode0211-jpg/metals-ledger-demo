import mongoose, { Schema, type Types } from "mongoose";
import { METALS, type Metal } from "./metals.js";

/**
 *   deposit_credit  approved deposit       available +amount
 *   hold            withdrawal created     available -amount, held +amount
 *   settle          withdrawal approved    held -amount (metal leaves the vault)
 *   release         withdrawal rejected    held -amount, available +amount
 */
export const ENTRY_KINDS = ["deposit_credit", "hold", "settle", "release"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];

/**
 * Append-only. Entries are never updated or deleted; a correction would be a
 * new entry. For every user and metal, the deltas add up to the balance
 * document - GET /api/admin/reconciliation checks exactly that.
 */
export interface ILedgerEntry {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  metal: Metal;
  request: Types.ObjectId;
  kind: EntryKind;
  availableDeltaMg: number;
  heldDeltaMg: number;
  // Balance right after this entry, so a statement never has to be replayed.
  availableAfterMg: number;
  heldAfterMg: number;
  // Who caused it: the holder for a hold, the admin for everything else.
  actor: Types.ObjectId;
  createdAt: Date;
}

const ledgerEntrySchema = new Schema<ILedgerEntry>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    metal: { type: String, enum: METALS, required: true },
    request: { type: Schema.Types.ObjectId, ref: "MetalRequest", required: true },
    kind: { type: String, enum: ENTRY_KINDS, required: true },
    availableDeltaMg: { type: Number, required: true },
    heldDeltaMg: { type: Number, required: true },
    availableAfterMg: { type: Number, required: true },
    heldAfterMg: { type: Number, required: true },
    actor: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, versionKey: false }
);

// Each step of a request (its hold, settle, release or credit) can be booked
// once. Second line of defence behind the status check in the ledger service.
ledgerEntrySchema.index({ request: 1, kind: 1 }, { unique: true });
ledgerEntrySchema.index({ user: 1, _id: -1 });

const refuseChange = () => {
  throw new Error("Ledger entries are append-only");
};

ledgerEntrySchema.pre(
  [
    "updateOne",
    "updateMany",
    "findOneAndUpdate",
    "replaceOne",
    "findOneAndReplace",
    "deleteOne",
    "deleteMany",
    "findOneAndDelete",
  ],
  { document: false, query: true },
  refuseChange
);

ledgerEntrySchema.pre("save", function () {
  if (!this.isNew) refuseChange();
});

const LedgerEntry = mongoose.model<ILedgerEntry>("LedgerEntry", ledgerEntrySchema, "ledger");
export default LedgerEntry;
