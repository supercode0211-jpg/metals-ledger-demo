import type { RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { AppError } from "../lib/errors.js";
import User, { type UserRole } from "../models/userModel.js";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

declare global {
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export const signToken = (userId: string): string =>
  jwt.sign({ id: userId }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });

// Bearer token here to keep the demo small. In the real app this is the
// existing cookie-based isAuthenticatedUser; nothing else depends on how the
// user was authenticated, only on req.user.
export const isAuthenticatedUser: RequestHandler = async (req, _res, next) => {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) {
    throw new AppError(401, "UNAUTHENTICATED", "Please log in to access this resource");
  }

  let userId: string;
  try {
    userId = (jwt.verify(token, config.jwtSecret) as { id: string }).id;
  } catch {
    throw new AppError(401, "UNAUTHENTICATED", "Session expired, please log in again");
  }

  const user = await User.findById(userId).lean();
  if (!user || user.closedAt) {
    throw new AppError(401, "UNAUTHENTICATED", "Please log in to access this resource");
  }

  req.user = { id: String(user._id), name: user.name, email: user.email, role: user.role };
  next();
};

export const authorizeRoles =
  (...roles: UserRole[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      throw new AppError(403, "FORBIDDEN", "You are not allowed to access this resource");
    }
    next();
  };
