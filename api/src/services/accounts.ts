import { Types } from "mongoose";
import User from "../models/userModel.js";
import Balance from "../models/balanceModel.js";
import MetalRequest from "../models/requestModel.js";
import { AppError } from "../lib/errors.js";
import { inTransaction } from "./transaction.js";

/**
 * Closing replaces deleting. A closed account can't sign in, but the user
 * document stays, so every ledger entry keeps pointing at someone real.
 * An account that still holds metal, or has a request waiting, can't be
 * closed at all - that metal has to be withdrawn or redeemed first.
 */
export async function closeAccount(userId: string): Promise<void> {
  if (!Types.ObjectId.isValid(userId)) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }

  await inTransaction(async (session) => {
    const user = await User.findById(userId).session(session);
    if (!user) throw new AppError(404, "USER_NOT_FOUND", "User not found");
    if (user.closedAt) return;

    const funded = await Balance.exists({
      user: userId,
      $or: [{ availableMg: { $gt: 0 } }, { heldMg: { $gt: 0 } }],
    }).session(session);
    const pending = await MetalRequest.exists({ user: userId, status: "pending" }).session(session);

    if (funded || pending) {
      throw new AppError(
        409,
        "ACCOUNT_NOT_EMPTY",
        "This account still holds metal or has pending requests; it can't be closed yet"
      );
    }

    user.closedAt = new Date();
    await user.save({ session });
  });
}
