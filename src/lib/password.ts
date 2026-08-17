import bcrypt from "bcryptjs";

// bcryptjs (pure JS) avoids Windows native build issues. Plaintext is never
// stored or logged (NFR-SE-010).
const COST_FACTOR = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST_FACTOR);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
