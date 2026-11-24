import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { AppError } from "../lib/errors.js";

export const notFound: RequestHandler = (req, res) => {
  res.status(404).json({
    success: false,
    code: "NOT_FOUND",
    message: `Route not found: ${req.method} ${req.originalUrl}`,
  });
};

export const errorMiddleware: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof AppError) {
    res.status(error.statusCode).json({ success: false, code: error.code, message: error.message });
    return;
  }

  if (error instanceof ZodError) {
    const message = error.issues
      .map((issue) => `${issue.path.join(".") || "request"}: ${issue.message}`)
      .join("; ");
    res.status(400).json({ success: false, code: "VALIDATION_FAILED", message });
    return;
  }

  // express.json() on a malformed body
  if ((error as { type?: string }).type === "entity.parse.failed") {
    res.status(400).json({ success: false, code: "INVALID_JSON", message: "Request body is not valid JSON" });
    return;
  }

  console.error(error);
  res.status(500).json({ success: false, code: "INTERNAL_ERROR", message: "Something went wrong" });
};
