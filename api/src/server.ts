import { createApp } from "./app.js";
import { config } from "./config.js";
import { connectDatabase, disconnectDatabase } from "./db.js";
import { seedDemoData } from "./seed.js";

async function main() {
  let uri = config.mongoUri;

  if (config.isProduction) {
    if (!uri) throw new Error("MONGO_URI is required in production");
    if (config.jwtSecret.length < 32) throw new Error("JWT_SECRET (32+ characters) is required in production");
  }

  let stopLocalDb: (() => Promise<unknown>) | undefined;
  if (!uri) {
    // Local convenience only. Transactions need a replica set, so this starts
    // a throwaway single-node one. Never used in production (checked above).
    const { MongoMemoryReplSet } = await import("mongodb-memory-server");
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    uri = replSet.getUri();
    stopLocalDb = () => replSet.stop();
    console.log("MONGO_URI not set: using an in-memory MongoDB replica set (resets on restart)");
  }

  await connectDatabase(uri);
  const seeded = await seedDemoData();
  if (seeded) console.log(seeded);

  const server = createApp().listen(config.port, () => {
    console.log(`API listening on http://localhost:${config.port}`);
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      server.close();
      void disconnectDatabase()
        .then(() => stopLocalDb?.())
        .finally(() => process.exit(0));
    });
  }
}

main().catch((error) => {
  console.error("API failed to start:", error);
  process.exit(1);
});
