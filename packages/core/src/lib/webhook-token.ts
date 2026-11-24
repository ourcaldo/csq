import { randomBytes } from "crypto";

// PRD 15 amendment (owner 2026-11-24, tenant-own-WABA): the Meta webhook
// verify token is per tenant, minted at provisioning (and re-minted on
// rotation). Authorizes nothing by itself - it only authenticates the
// one-time webhook handshake; inbound authenticity is the per-channel
// appSecret HMAC.
export function generateWebhookVerifyToken(): string {
  return `csq-${randomBytes(16).toString("hex")}`;
}
