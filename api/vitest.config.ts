import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // First run downloads a mongod binary for mongodb-memory-server.
    hookTimeout: 180_000,
    testTimeout: 60_000,
    // Each file starts its own in-memory replica set; one at a time is plenty.
    fileParallelism: false,
  },
});
