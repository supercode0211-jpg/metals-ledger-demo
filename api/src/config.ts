import { randomBytes } from "node:crypto";

const isProduction = process.env.NODE_ENV === "production";

export const config = {
  port: Number(process.env.API_PORT ?? 4000),
  mongoUri: process.env.MONGO_URI ?? "",
  isProduction,
  // Local runs and tests get a throwaway secret. Production must bring its own
  // (server.ts refuses to start without one).
  jwtSecret: process.env.JWT_SECRET ?? (isProduction ? "" : randomBytes(32).toString("hex")),
  jwtExpiresIn: "8h",
} as const;
