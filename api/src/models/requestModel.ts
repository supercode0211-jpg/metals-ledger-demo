import mongoose, { Schema, type Types } from "mongoose";
import { METALS, type Metal } from "./metals.js";

export const REQUEST_TYPES = ["deposit", "withdrawal", "redemption"] as const;
export type RequestType = (typeof REQUEST_TYPES)[number];

export const REQUEST_STATUSES = ["pending", "completed", "rejected"] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/**
 * A holder asking to move metal in or out. It stays pending until an admin
 * approves or rejects it.
 *
 * Withdrawals and redemptions hold their amount the moment they are created
 * (see services/ledger.ts), so the same grams can't be asked for twice while
 * the first request is waiting. A redemption is a withdrawal that ends in
 * physical delivery; the money side is identical.
 */
export interface IMetalRequest {
  _id: Types.ObjectId;
  user: Types.ObjectId;
  type: RequestType;
  metal: Metal;
  amountMg: number;
  status: RequestStatus;
  note?: string;
  // Client-generated key, unique per user, so a retried POST can't create a
  // second request.
  idempotencyKey: string;
  // type:metal:amount of the original call, to catch a key reused for
  // something else.
  fingerprint: string;
  decidedBy?: Types.ObjectId;
  decidedAt?: Date;
  reason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const requestSchema = new Schema<IMetalRequest>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true },
    type: { type: String, enum: REQUEST_TYPES, required: true },
    metal: { type: String, enum: METALS, required: true },
    amountMg: { type: Number, required: true, min: 1 },
    status: { type: String, enum: REQUEST_STATUSES, default: "pending" },
    note: { type: String, maxlength: 500 },
    idempotencyKey: { type: String, required: true },
    fingerprint: { type: String, required: true },
    decidedBy: { type: Schema.Types.ObjectId, ref: "User" },
    decidedAt: Date,
    reason: { type: String, maxlength: 500 },
  },
  { timestamps: true, versionKey: false }
);

requestSchema.index({ user: 1, idempotencyKey: 1 }, { unique: true });
requestSchema.index({ status: 1, createdAt: 1 });
requestSchema.index({ user: 1, _id: -1 });

const MetalRequest = mongoose.model<IMetalRequest>("MetalRequest", requestSchema, "requests");
export default MetalRequest;
