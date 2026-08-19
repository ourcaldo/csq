// Reusable data-fetching hook for dashboard list/detail pages. The page owns
// its filter state and builds the request URL (including query + page); this
// hook handles loading/error/refresh. `refresh()` bumps an internal nonce to
// re-run the effect without changing the URL — used after mutations.
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";

export type UseApiResult<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

export function useApi<T>(url: string): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  // Track the first load so refresh() doesn't toggle `loading` (which would
  // flash the loading skeleton on every poll/refresh and blink the page).
  const firstRef = useRef(true);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let active = true;
    const first = firstRef.current;
    if (first) setLoading(true);
    apiFetch<T>(url)
      .then((d) => {
        if (active) {
          setData(d);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setError(err instanceof ApiError ? err.message : "Gagal memuat data.");
        }
      })
      .finally(() => {
        if (active && first) setLoading(false);
        firstRef.current = false;
      });
    return () => {
      active = false;
    };
  }, [url, nonce]);

  return { data, loading, error, refresh };
}
