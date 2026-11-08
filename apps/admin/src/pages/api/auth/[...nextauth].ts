import type { NextApiRequest, NextApiResponse } from "next";
import nextAuth from "next-auth";
import { adminAuthOptions } from "@/lib/admin-auth";

// The admin auth endpoint - its own realm, its own options (PRD 13).
export default function handler(req: NextApiRequest, res: NextApiResponse) {
  return nextAuth(req, res, adminAuthOptions);
}
