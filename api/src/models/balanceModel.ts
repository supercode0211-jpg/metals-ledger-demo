import mongoose, { Schema, type Types } from "mongoose";
import { METALS, type Metal } from "./metals.js";

/**
 * One document per user and metal, in whole milligrams.
 *
 *   availableMg  what the holder can withdraw or redeem right now
 *   heldMg       reserved by their pending withdrawals and redemptions
 *   total        availableMg + heldMg
 *
 * Only services/ledger.ts writes here, and always inside the same transaction
 * as the ledger entry that explains the change.
 */
export interface IBalance {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  metal: Metal;
  availableMg: number;
  heldMg: number;
  updatedAt: Date;
}

const balanceSchema = new Schema<IBalance>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    metal: { type: String, enum: METALS, required: true },
    availableMg: { type: Number, required: true, default: 0 },
    heldMg: { type: Number, required: true, default: 0 },
  },
  { timestamps: { createdAt: false, updatedAt: true }, versionKey: false }
);

balanceSchema.index({ user: 1, metal: 1 }, { unique: true });

/**
 * Collection validator, enforced by MongoDB itself. Whatever goes wrong in the
 * code (or in a hand-typed fix in the shell), a balance can't be stored
 * negative or fractional.
 */
export const balanceValidator = {
  $jsonSchema: {
    bsonType: "object",
    required: ["user", "metal", "availableMg", "heldMg"],
    properties: {
      metal: { enum: [...METALS] },
      availableMg: { bsonType: "number", minimum: 0, multipleOf: 1 },
      heldMg: { bsonType: "number", minimum: 0, multipleOf: 1 },
    },
  },
};

const Balance = mongoose.model<IBalance>("Balance", balanceSchema);
export default Balance;
