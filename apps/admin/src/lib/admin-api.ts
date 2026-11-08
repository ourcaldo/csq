import { useCallback, useEffect, useState } from "react";

// Minimal data-fetch hook for the admin BFF. Same contract as the
// dashboard's useApi: url + loading + error + refresh. Cookie-based auth
// (the admin session rides the NextAuth cookie automatically).
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
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok || !body.success) {
          throw new Error(body?.error?.message ?? `HTTP ${res.status}`);
        }
        return body.data as T;
      })
      .then((d) => {
        if (active) {
          setData(d);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(err instanceof Error ? err.message : "Gagal memuat data.");
        }
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
  const json = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json?.error?.message ?? `HTTP ${res.status}`);
  }
  return json.data as T;
}
