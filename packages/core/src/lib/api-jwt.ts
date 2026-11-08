import { SignJWT, jwtVerify } from "jose";
import { z } from "zod";

// Stateless access JWTs for the /api/v1 user realm (PRD 23C Phase 8).
// HS256 with the API_JWT_SECRET env (set on the api service). Claims: sub =
// userId, tid = tenantId, role, typ = "access". 15-minute lifetime; anything
// longer-lived goes through the refresh-token flow instead. Fail-closed: no
// secret configured means verify returns null (nothing authenticates).

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

const claimsSchema = z.object({
  sub: z.string(),
  tid: z.string(),
  role: z.string(),
  typ: z.literal("access"),
});

function key(): Uint8Array {
  const secret = process.env.API_JWT_SECRET;
  if (!secret) throw new Error("API_JWT_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(input: {
  userId: string;
  tenantId: string;
  role: string;
}): Promise<string> {
  return new SignJWT({ tid: input.tenantId, role: input.role, typ: "access" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(input.userId)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(key());
}

export async function verifyAccessToken(
  token: string
): Promise<{ userId: string; tenantId: string; role: string } | null> {
  if (!process.env.API_JWT_SECRET) return null;
  try {
    const { payload } = await jwtVerify(token, key());
    const parsed = claimsSchema.safeParse(payload);
    return parsed.success
      ? {
          userId: parsed.data.sub,
          tenantId: parsed.data.tid,
          role: parsed.data.role,
        }
      : null;
  } catch {
    return null;
  }
}
