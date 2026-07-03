import { randomBytes, createHash } from "node:crypto";

/** 7 days, matching the session TTL precedent in app.ts. */
export const INVITE_TTL_SECONDS = 60 * 60 * 24 * 7;

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** A fresh invite token. Only the hash is ever persisted (see migration 016). */
export function generateInviteToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("hex");
  return { token, tokenHash: hashInviteToken(token) };
}

export function slugFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "user";
  const slug = local
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 32);
  return `${slug || "user"}-${randomBytes(4).toString("hex")}`;
}
