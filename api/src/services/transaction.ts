import mongoose, { type ClientSession } from "mongoose";

/**
 * Runs `work` in a MongoDB transaction (needs a replica set: Atlas, or a local
 * single-node one).
 *
 * withTransaction retries the whole callback on transient errors, which is
 * what concurrent requests touching the same balance produce. So `work` must
 * only talk to the database: no emails, no HTTP calls, nothing that would
 * happen twice on a retry.
 */
export async function inTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
  const session = await mongoose.startSession();
  try {
    let result: T | undefined;
    await session.withTransaction(
      async () => {
        result = await work(session);
      },
      { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" } }
    );
    return result as T;
  } finally {
    await session.endSession();
  }
}
