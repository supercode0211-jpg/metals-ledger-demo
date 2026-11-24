import express from "express";
import mongoose from "mongoose";
import userRoutes from "./routes/users.js";
import holdingRoutes from "./routes/holdings.js";
import adminRoutes from "./routes/admin.js";
import reserveRoutes from "./routes/reserve.js";
import { errorMiddleware, notFound } from "./middlewares/errorMiddleware.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "20kb" }));

  app.get("/health", (_req, res) => {
    const connected = mongoose.connection.readyState === 1;
    res.status(connected ? 200 : 503).json({ success: connected, database: connected ? "connected" : "disconnected" });
  });

  app.use("/user", userRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api", holdingRoutes);
  app.use("/api", reserveRoutes);

  app.use(notFound);
  app.use(errorMiddleware);

  return app;
}
