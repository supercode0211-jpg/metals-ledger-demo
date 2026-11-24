import bcrypt from "bcryptjs";
import User from "./models/userModel.js";
import { createRequest, decideRequest } from "./services/ledger.js";
import type { Metal } from "./models/metals.js";
import { gramsToMg } from "./lib/grams.js";

export const DEMO_PASSWORD = "demo1234";

/**
 * Creates a few demo accounts on an empty database. Balances are built by
 * going through the same request/approve flow as the API, never by writing
 * numbers into balances, so the seeded data reconciles from the first run.
 */
export async function seedDemoData(): Promise<string | null> {
  if ((await User.estimatedDocumentCount()) > 0) return null;

  const password = await bcrypt.hash(DEMO_PASSWORD, 10);
  const [admin, maya, omar] = await User.create([
    { name: "Ops Admin", email: "admin@demo.local", password, role: "admin" },
    { name: "Maya Holder", email: "maya@demo.local", password },
    { name: "Omar Holder", email: "omar@demo.local", password },
  ]);

  const adminId = String(admin!._id);
  const mayaId = String(maya!._id);
  const omarId = String(omar!._id);

  const approvedDeposit = async (userId: string, key: string, metal: Metal, grams: string) => {
    const { request } = await createRequest(userId, { type: "deposit", metal, amountMg: gramsToMg(grams) }, key);
    await decideRequest(adminId, String(request._id), "approve");
  };

  await approvedDeposit(mayaId, "seed-maya-gold", "gold", "156.750");
  await approvedDeposit(mayaId, "seed-maya-silver", "silver", "892.400");
  await approvedDeposit(mayaId, "seed-maya-platinum", "platinum", "45.200");
  await approvedDeposit(omarId, "seed-omar-gold", "gold", "12.345");

  // Left pending so the admin queue has something in it.
  await createRequest(mayaId, { type: "withdrawal", metal: "gold", amountMg: gramsToMg("20") }, "seed-maya-withdraw");
  await createRequest(
    mayaId,
    { type: "redemption", metal: "silver", amountMg: gramsToMg("100"), note: "1 x 100 g bar, insured shipping" },
    "seed-maya-redeem"
  );
  await createRequest(omarId, { type: "deposit", metal: "platinum", amountMg: gramsToMg("5.5") }, "seed-omar-deposit");

  return `Demo accounts (password ${DEMO_PASSWORD}): admin@demo.local, maya@demo.local, omar@demo.local`;
}
