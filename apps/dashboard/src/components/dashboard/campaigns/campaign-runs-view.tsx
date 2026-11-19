// Riwayat Kirim - full-page view (owner request 2026-11-19, reference
// docs/demo/kampanye_csq_demo_interaktif.html: "halaman penuh, tanpa pop-up
// & tanpa collapse"). One card per run: Sesi #, started/finished, count
// chips, and the per-recipient table (Nomor Tujuan, Kontak, Status,
// Keterangan) ALWAYS VISIBLE - no expand, no collapse. Loads the run list
// and every run's recipient log on mount.
import { useEffect, useState } from "react";
import { ClockCounterClockwise } from "@phosphor-icons/react";
import type { CampaignRunRow } from "@csq/core/types/campaign";
import { apiFetch } from "@/lib/api-client";
import { formatDateTime } from "./format";
import { cn } from "@csq/ui/lib/utils";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    SENT: "bg-green-100 text-green-700",
    FAILED: "bg-red-100 text-red-700",
    SKIPPED: "bg-amber-100 text-amber-700",
    PENDING: "bg-slate-100 text-slate-600",
  };
  const label: Record<string, string> = {
    SENT: "Terkirim",
    FAILED: "Gagal",
    SKIPPED: "Dilewati",
    PENDING: "Menunggu",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium",
        map[status] ?? map.PENDING
      )}
    >
      {label[status] ?? "Menunggu"}
    </span>
  );
}

function CountChip(props: { label: string; value: number | undefined; cls: string }) {
  return (
    <span className={cn("rounded-md border px-2.5 py-1 font-medium", props.cls)}>
      {props.label}: <strong>{props.value ?? 0}</strong>
    </span>
  );
}

export function CampaignRunsView(props: {
  campaignId: string;
  onBack: () => void;
}) {
  const [runs, setRuns] = useState<CampaignRunRow[] | null>(null);
  const [details, setDetails] = useState<Record<string, CampaignRunRow>>({});
  const [error, setError] = useState<string | null>(null);

  // Load the run list, then every run's recipient log - all upfront, so the
  // page renders fully expanded (no collapse, owner request 2026-11-19).
  useEffect(() => {
    let cancelled = false;
    setRuns(null);
    setDetails({});
    setError(null);
    apiFetch<{ runs: CampaignRunRow[] }>(
      `/api/dashboard/campaigns/${props.campaignId}/runs`
    )
      .then(async (data) => {
        if (cancelled) return;
        setRuns(data.runs);
        const entries = await Promise.all(
          data.runs.map(async (r) => {
            try {
              const detail = await apiFetch<{ run: CampaignRunRow }>(
                `/api/dashboard/campaigns/${props.campaignId}/runs?runId=${r.id}&pageSize=500`
              );
              return [r.id, detail.run] as const;
            } catch {
              return [r.id, r] as const;
            }
          })
        );
        if (!cancelled) setDetails(Object.fromEntries(entries));
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Gagal memuat riwayat.");
          setRuns([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [props.campaignId]);

  return (
    <div className="space-y-6">
      {error && <p className="text-sm text-destructive">{error}</p>}

      {runs === null && (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
          <p className="text-sm font-medium text-slate-700">Memuat riwayat...</p>
        </div>
      )}

      {runs !== null && runs.length === 0 && (
        <div className="rounded-xl border border-slate-200 bg-white px-6 py-12 text-center shadow-sm">
          <ClockCounterClockwise size={28} className="mx-auto text-slate-400" />
          <p className="mt-2 text-sm font-medium text-slate-700">Belum pernah kirim</p>
          <p className="mt-1 text-xs text-slate-500">
            Kampanye ini belum memiliki riwayat pengiriman.
          </p>
        </div>
      )}

      {runs?.map((r, idx) => {
        const detail = details[r.id];
        const messages = detail?.messages;
        return (
          <section
            key={r.id}
            className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
          >
            <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                    Sesi #{runs.length - idx}
                  </span>
                  <h2 className="text-base font-semibold text-slate-900">
                    {formatDateTime(r.startedAt)}
                  </h2>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {r.finishedAt
                    ? `Selesai pada ${formatDateTime(r.finishedAt)}`
                    : "Sedang berjalan"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <CountChip label="Total" value={r.counts?.total} cls="border-slate-200 bg-slate-50 text-slate-700" />
                <CountChip label="Terkirim" value={r.counts?.sent} cls="border-green-200 bg-green-50 text-green-700" />
                <CountChip label="Gagal" value={r.counts?.failed} cls="border-red-200 bg-red-50 text-red-700" />
                <CountChip label="Dilewati" value={r.counts?.skipped} cls="border-amber-200 bg-amber-50 text-amber-700" />
              </div>
            </div>

            {messages === undefined ? (
              <div className="border-t border-slate-200 bg-slate-50/50 px-5 py-4 text-xs text-slate-500">
                Memuat log per nomor...
              </div>
            ) : (messages.length ?? 0) === 0 ? (
              <div className="border-t border-slate-200 bg-slate-50/50 px-5 py-4 text-xs text-slate-500">
                Detail log pesan per nomor tidak tersedia untuk sesi kirim ini
                (seluruh {r.counts?.sent ?? 0} pesan tercatat terkirim).
              </div>
            ) : (
              <div className="overflow-x-auto border-t border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      <th className="px-4 py-2.5">Nomor Tujuan</th>
                      <th className="px-4 py-2.5">Kontak</th>
                      <th className="px-4 py-2.5">Status</th>
                      <th className="px-4 py-2.5">Keterangan</th>
                    </tr>
                  </thead>
                  <tbody>
                    {messages.map((m) => (
                      <tr
                        key={m.id}
                        className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/70"
                      >
                        <td className="px-4 py-2.5 font-mono text-xs text-slate-800">
                          {m.phone}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-600">
                          {m.contactName ?? <span className="text-slate-400">-</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          <StatusBadge status={m.status} />
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-500">
                          {m.reason ?? <span className="text-slate-300">-</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
