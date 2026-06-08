import { z } from "zod";
import { ROLES } from "../rbac.js";

export function isRole(value: string): value is (typeof ROLES)[number] {
  return (ROLES as readonly string[]).includes(value);
}

export const CreateUserInputSchema = z.object({
  email: z.email().max(200),
  password: z.string().min(8).max(200),
  role: z.string().refine(isRole, "invalid role"),
});

export const RoleInputSchema = z.object({ role: z.string().refine(isRole, "invalid role") });

export const StatusInputSchema = z.object({ status: z.enum(["active", "disabled"]) });
