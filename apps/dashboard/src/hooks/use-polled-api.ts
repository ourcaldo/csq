import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch, ApiError } from "@/lib/api-client";

// Polled list cache (PRD 09, SWR-style inbox cache). The inbox polls every
// 8s; this hook:
//   - dedupes overlapping requests (a slow poll never stacks),
//   - keeps the previous data while revalidating (no loading flash),
//   - returns the SAME object reference when the payload is unchanged, so the
//     memoized conversation rows do not re-render on every poll.
// It is scoped to the polled list; other pages keep the simpler useApi.

export type UsePolledApiResult<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

export function usePolledApi<T>(url: string, pollMs: number): UsePolledApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const dataRef = useRef<T | null>(null);
  const tickRef = useRef<() => void>(() => undefined);

  const refresh = useCallback(() => tickRef.current(), []);

  useEffect(() => {
    let active = true;
    let inflight = false;

    async function tick() {
      if (inflight) return;
      inflight = true;
      try {
        const next = await apiFetch<T>(url);
        if (!active) return;
        const prev = dataRef.current;
        // Stable reference: an unchanged payload must not re-render the list.
        if (prev === null || JSON.stringify(prev) !== JSON.stringify(next)) {
          dataRef.current = next;
          setData(next);
        }
        setError(null);
      } catch (err) {
        if (active) {
          setError(err instanceof ApiError ? err.message : "Gagal memuat data.");
        }
      } finally {
        inflight = false;
        if (active) setLoading(false);
      }
    }

    tickRef.current = () => {
      void tick();
    };
    void tick();
    const timer = setInterval(() => {
      void tick();
    }, pollMs);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [url, pollMs]);

  return { data, loading, error, refresh };
}
