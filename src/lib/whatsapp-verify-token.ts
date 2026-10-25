import crypto from "crypto";

// Fresh webhook verify token, generated server-side — the client never
// supplies it. Called when the owner enters the Cloud API connect step, so
// the token is on screen (and persisted on the channel row) BEFORE
// Sambungkan; Meta can verify the webhook immediately.
export function generateVerifyToken(): string {
  return `csq-${crypto.randomBytes(18).toString("base64url")}`;
}
