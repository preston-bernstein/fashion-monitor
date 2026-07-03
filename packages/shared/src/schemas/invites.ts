import { z } from "zod";

export const InviteRedeemInputSchema = z.object({
  token: z.string().min(1),
  email: z.email().max(200),
  password: z.string().min(8).max(200),
});

export const PasswordResetRedeemInputSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8).max(200),
});
