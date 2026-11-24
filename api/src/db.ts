import mongoose from "mongoose";
import User from "./models/userModel.js";
import Balance, { balanceValidator } from "./models/balanceModel.js";
import MetalRequest from "./models/requestModel.js";
import LedgerEntry from "./models/ledgerEntryModel.js";

mongoose.set("strictQuery", true);
// Collections and indexes are created explicitly below, before any request
// is served. Transactions can't rely on them appearing lazily.
mongoose.set("autoCreate", false);
mongoose.set("autoIndex", false);

const MODELS = [User, Balance, MetalRequest, LedgerEntry];

export async function connectDatabase(uri: string, dbName?: string): Promise<void> {
  await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 5000 });
  await prepareCollections();
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

async function prepareCollections(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) throw new Error("Not connected");

  const existing = new Set(
    (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name)
  );

  for (const model of MODELS) {
    const name = model.collection.collectionName;
    const validation =
      model === Balance
        ? { validator: balanceValidator, validationLevel: "strict" as const, validationAction: "error" as const }
        : undefined;

    if (!existing.has(name)) {
      await db.createCollection(name, validation);
    } else if (validation) {
      // Keeps the validator current on databases created by an older version.
      await db.command({ collMod: name, ...validation });
    }
    await model.createIndexes();
  }
}
