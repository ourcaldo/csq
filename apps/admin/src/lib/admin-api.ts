import { useCallback, useEffect, useState } from "react";
import { z } from "zod";

// Minimal data-fetch hook for the admin BFF. Same contract as the
// dashboard's useApi: url + loading + error + refresh. Cookie-based auth
// (the admin session rides the NextAuth cookie automatically).

// A crashed route returns a plain-text error page, not the JSON envelope -
// parse defensively so the UI shows a readable message instead of a JSON
// tokenizer error.
const envelopeSchema = z.object({
  success: z.boolean().optional(),
  error: z.object({ message: z.string().optional() }).optional(),
  data: z.unknown().optional(),
});

function readEnvelope(res: Response): Promise<
  { ok: true; data: unknown } | { ok: false; message: string }
> {
  return res.text().then((text) => {
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null; // plain-text error page, e.g. a 500
    }
    const body = envelopeSchema.safeParse(parsed);
    if (!res.ok || !body.success || !body.data?.success) {
      return {
        ok: false,
        message:
          body.data?.error?.message ?? `Gagal memuat data (HTTP ${res.status}).`,
      };
    }
    return { ok: true, data: body.data.data };
  });
}

export function useAdminApi<T>(url: string): {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    fetch(url, { credentials: "same-origin" })
      .then((res) => readEnvelope(res))
      .then((result) => {
        if (!active) return;
        if (result.ok) {
          setData(result.data as T);
          setError(null);
        } else {
          setError(result.message);
        }
      })
      .catch(() => {
        if (active) setError("Gagal memuat data.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [url, nonce]);

  return { data, loading, error, refresh };
}

// POST/PUT/PATCH/DELETE helper that returns the parsed envelope.
export async function adminFetch<T>(
  url: string,
  method: "POST" | "PUT" | "PATCH" | "DELETE",
  body?: unknown
): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await readEnvelope(res);
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.data as T;
}

