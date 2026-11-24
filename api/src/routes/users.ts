import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import User from "../models/userModel.js";
import { AppError } from "../lib/errors.js";
import { userView } from "../lib/views.js";
import { isAuthenticatedUser, signToken } from "../middlewares/auth.js";

const router = Router();

const loginBody = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});

router.post("/login", async (req, res) => {
  const { email, password } = loginBody.parse(req.body);

  const user = await User.findOne({ email }).select("+password");
  const valid = user && !user.closedAt && (await bcrypt.compare(password, user.password));
  if (!user || !valid) {
    throw new AppError(401, "INVALID_CREDENTIALS", "Invalid email or password");
  }

  res.json({ success: true, token: signToken(String(user._id)), user: userView(user) });
});

router.get("/me", isAuthenticatedUser, (req, res) => {
  res.json({ success: true, user: req.user });
});

export default router;
