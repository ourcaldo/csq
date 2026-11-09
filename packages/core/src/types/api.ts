// Standard API response envelope (SDD §5.1). Every API route returns this shape.
// success:true  → data present, error absent.
// success:false → error present, data absent (exception: approval-required
//   responses carry data alongside success:false - see APPROVAL_REQUIRED).

export type ApiResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: { code: ErrorCode; message: string };
};

// Consolidated error codes (SDD §5.2 / §6.6). METHOD_NOT_ALLOWED and
// RATE_LIMITED joined with the /api/v1 token realm (PRD 23C Phase 7).
export type ErrorCode =
  | "UNAUTHORIZED"
  | "PERMISSION_DENIED"
  | "FEATURE_DISABLED"
  | "APPROVAL_REQUIRED"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "TOOL_NOT_FOUND"
  | "METHOD_NOT_ALLOWED"
  | "RATE_LIMITED"
  | "TENANT_SUSPENDED"
  | "INTERNAL_ERROR";

export const ErrorCodes: Record<ErrorCode, ErrorCode> = {
  UNAUTHORIZED: "UNAUTHORIZED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  FEATURE_DISABLED: "FEATURE_DISABLED",
  APPROVAL_REQUIRED: "APPROVAL_REQUIRED",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  TOOL_NOT_FOUND: "TOOL_NOT_FOUND",
  METHOD_NOT_ALLOWED: "METHOD_NOT_ALLOWED",
  RATE_LIMITED: "RATE_LIMITED",
  TENANT_SUSPENDED: "TENANT_SUSPENDED",
  INTERNAL_ERROR: "INTERNAL_ERROR",
};

export function apiOk<T>(data: T): ApiResponse<T> {
  return { success: true, data };
}

export function apiError(code: ErrorCode, message: string): ApiResponse<never> {
  return { success: false, error: { code, message } };
}
