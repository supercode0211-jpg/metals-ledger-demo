import mongoose, { Schema, type Types } from "mongoose";

export type UserRole = "user" | "admin";

export interface IUser {
  _id: Types.ObjectId;
  name: string;
  email: string;
  password: string;
  role: UserRole;
  // Accounts that have held metal are closed, never deleted, so their ledger
  // history keeps pointing at a real user.
  closedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true, select: false },
    role: { type: String, enum: ["user", "admin"], default: "user" },
    closedAt: Date,
  },
  { timestamps: true }
);

const User = mongoose.model<IUser>("User", userSchema);
export default User;
