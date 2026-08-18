// Typed browser-side fetch wrapper for the dashboard REST routes.
//
// Every dashboard API returns the ApiResponse<T> envelope (src/types/api.ts).
// This unwraps it generically — no `as` assertions: the JSON body is assigned
// to a typed local via annotation (res.json() is `any` from lib.dom), then the
// success/data fields are checked before returning data. On failure an ApiError
// carrying the server's error code + message is thrown.
import type { ApiResponse } from "@/types/api";

export class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

export async function apiFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { credentials: "include", ...init });

  if (res.status === 401) {
    throw new ApiError("UNAUTHORIZED", "Sesi berakhir. Silakan masuk kembali.");
  }

  let body: ApiResponse<T>;
  try {
    body = await res.json();
  } catch {
    throw new ApiError("INTERNAL_ERROR", "Respons server tidak valid.");
  }

  if (!body.success || body.data === undefined) {
    throw new ApiError(
      body.error?.code ?? "INTERNAL_ERROR",
      body.error?.message ?? "Gagal memuat data."
    );
  }
  return body.data;
}

// Convenience for mutations (POST/PUT/DELETE with a JSON body). Keeps pages
// from repeating Content-Type / JSON.stringify boilerplate.
export async function apiSend<T>(
  url: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown
): Promise<T> {
  return apiFetch<T>(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}
