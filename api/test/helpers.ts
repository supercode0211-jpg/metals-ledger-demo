import { MongoMemoryReplSet } from "mongodb-memory-server";
import bcrypt from "bcryptjs";
import { connectDatabase, disconnectDatabase } from "../src/db.js";
import User, { type UserRole } from "../src/models/userModel.js";
import Balance from "../src/models/balanceModel.js";
import MetalRequest from "../src/models/requestModel.js";
import LedgerEntry from "../src/models/ledgerEntryModel.js";
import { createRequest, decideRequest, getBalances } from "../src/services/ledger.js";
import { gramsToMg } from "../src/lib/grams.js";
import type { Metal } from "../src/models/metals.js";

let replSet: MongoMemoryReplSet | undefined;

export async function startDatabase() {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await connectDatabase(replSet.getUri(), "ledger-test");
}

export async function stopDatabase() {
  await disconnectDatabase();
  await replSet?.stop();
}

export async function clearDatabase() {
  await Promise.all([
    User.deleteMany({}),
    Balance.deleteMany({}),
    MetalRequest.deleteMany({}),
    // The model refuses deletes on purpose; tests go around it on the raw collection.
    LedgerEntry.collection.deleteMany({}),
  ]);
}

export const PASSWORD = "test-password";
let passwordHash: string | undefined;
let counter = 0;

export async function makeUser(role: UserRole = "user") {
  passwordHash ??= await bcrypt.hash(PASSWORD, 4);
  counter += 1;
  const user = await User.create({
    name: `${role} ${counter}`,
    email: `${role}${counter}@test.local`,
    password: passwordHash,
    role,
  });
  return String(user._id);
}

let keyCounter = 0;
export const newKey = () => `test-key-${Date.now()}-${++keyCounter}`;

/** Deposit approved by `adminId`, i.e. metal that is really in the account. */
export async function fund(userId: string, adminId: string, metal: Metal, grams: string) {
  const { request } = await createRequest(userId, { type: "deposit", metal, amountMg: gramsToMg(grams) }, newKey());
  await decideRequest(adminId, String(request._id), "approve");
}

export async function balanceOf(userId: string, metal: Metal) {
  const rows = await getBalances(userId);
  return rows.find((r) => r.metal === metal)!;
}
