import { createHash, randomBytes } from "crypto";

// Opaque refresh tokens for the /api/v1/auth exchange (PRD 23C Phase 8).
// Same storage rules as API keys: plaintext exists only in the response,
// the sha256 hash is what persists. 30-day lifetime, rotated on every use.

export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function generateRefreshToken(): { token: string; hash: string } {
  const token = `rt_${randomBytes(32).toString("base64url")}`;
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
