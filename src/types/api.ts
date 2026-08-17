// Standard API response envelope (SDD §5.1). Every API route returns this shape.
// success:true  → data present, error absent.
// success:false → error present, data absent (exception: approval-required
//   responses carry data alongside success:false — see APPROVAL_REQUIRED).

export type ApiResponse<T = unknown> = {
  success: boolean;
  data?: T;
  error?: { code: ErrorCode; message: string };
};

// Consolidated error codes (SDD §5.2 / §6.6).
export type ErrorCode =
  | "UNAUTHORIZED"
  | "PERMISSION_DENIED"
  | "APPROVAL_REQUIRED"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "TOOL_NOT_FOUND"
  | "INTERNAL_ERROR";

export const ErrorCodes: Record<ErrorCode, ErrorCode> = {
  UNAUTHORIZED: "UNAUTHORIZED",
  PERMISSION_DENIED: "PERMISSION_DENIED",
  APPROVAL_REQUIRED: "APPROVAL_REQUIRED",
  VALIDATION_ERROR: "VALIDATION_ERROR",
  NOT_FOUND: "NOT_FOUND",
  TOOL_NOT_FOUND: "TOOL_NOT_FOUND",
  INTERNAL_ERROR: "INTERNAL_ERROR",
};

export function apiOk<T>(data: T): ApiResponse<T> {
  return { success: true, data };
}

export function apiError(code: ErrorCode, message: string): ApiResponse<never> {
  return { success: false, error: { code, message } };
}
