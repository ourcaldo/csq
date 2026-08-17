import type { NextApiResponse } from "next";
import type { Session } from "next-auth";
import { apiError, type ErrorCode } from "@/types/api";

// Tenant is NEVER read from the request body/query — always from the session.
// Called after getAuthSession has confirmed a session exists. A missing
// tenantId on an authenticated session is an invariant violation (500).
export function requireTenant(session: Session): string {
  const tenantId = session.user.tenantId;
  if (!tenantId) {
    throw new Error("Authenticated session has no tenantId.");
  }
  return tenantId;
}

// Throw to short-circuit a route with a typed error code. Caught by the
// route's try/catch (or the transaction wrapper) and turned into an envelope.
export class HttpError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const HTTP_STATUS: Record<ErrorCode, number> = {
  UNAUTHORIZED: 401,
  PERMISSION_DENIED: 403,
  APPROVAL_REQUIRED: 202,
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  TOOL_NOT_FOUND: 404,
  INTERNAL_ERROR: 500,
};

export function respondError(
  res: NextApiResponse,
  code: ErrorCode,
  message: string
): void {
  res.status(HTTP_STATUS[code]).json(apiError(code, message));
}

// Parse a query param (string | string[] | undefined) into a clamped int.
export function intQuery(
  query: Record<string, string | string[] | undefined>,
  key: string,
  def: number,
  min: number,
  max: number
): number {
  const raw = query[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isNaN(parsed)) return def;
  return Math.min(max, Math.max(min, parsed));
}

export function strQuery(
  query: Record<string, string | string[] | undefined>,
  key: string
): string | undefined {
  const raw = query[key];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value && value.length > 0 ? value : undefined;
}

export function paginate(query: Record<string, string | string[] | undefined>) {
  const page = intQuery(query, "page", 1, 1, 1_000_000);
  const pageSize = intQuery(query, "pageSize", 20, 1, 100);
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}
