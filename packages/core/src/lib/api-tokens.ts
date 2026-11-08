import { createHash, randomBytes } from "crypto";

// API token minting for the /api/v1 realm (PRD 23C Phase 7). Format:
// "csq_" + 43 base64url chars (~256 bits). The plaintext exists exactly once
// - in the mint response the owner sees. Storage keeps only the sha256 hash
// plus a display prefix. Exported for the self-check.

const PREFIX_LEN = 12;

export function generateApiToken(): {
  token: string;
  hash: string;
  prefix: string;
} {
  const token = `csq_${randomBytes(32).toString("base64url")}`;
  return {
    token,
    hash: hashApiToken(token),
    prefix: token.slice(0, PREFIX_LEN),
  };
}

export function hashApiToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
