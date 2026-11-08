import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react";
import type { EntitlementsView } from "@/components/dashboard/entitlements-context";

// Owner quota indicator in the header. A ring shows the worst counter; the
// details sit behind a click instead of a full-width banner.

type QuotaRow = { label: string; used: number; limit: number };

function buildRows(entitlements: EntitlementsView): QuotaRow[] {
  const rows: QuotaRow[] = [];
  if (entitlements.aiCreditsPerMonth !== null) {
    rows.push({
      label: "Kredit AI",
      used: entitlements.usage.creditsUsed,
      limit: entitlements.aiCreditsPerMonth,
    });
  }
  if (entitlements.mauLimit !== null) {
    rows.push({ label: "MAU", used: entitlements.usage.mau, limit: entitlements.mauLimit });
  }
  if (entitlements.staffLimit !== null) {
    rows.push({ label: "Staf", used: entitlements.usage.staff, limit: entitlements.staffLimit });
  }
  if (entitlements.channelLimit !== null) {
    rows.push({
      label: "Saluran",
      used: entitlements.usage.channels,
      limit: entitlements.channelLimit,
    });
  }
  return rows;
}

export function QuotaMenu({ entitlements }: { entitlements: EntitlementsView | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && (!(e.target instanceof Node) || !ref.current.contains(e.target))) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  if (!entitlements) return null;
  const rows = buildRows(entitlements);
  if (rows.length === 0) return null;

  const maxPct = Math.max(...rows.map((r) => Math.round((r.used / r.limit) * 100)));
  const ringPct = Math.min(100, maxPct);
  const atLimit = rows.some((r) => r.used >= r.limit);
  const bad = entitlements.billingOverdue || atLimit;
  const warn = maxPct >= 80;
  const color = bad ? "#dc2626" : warn ? "#d97706" : "#16a34a";
  const circumference = 2 * Math.PI * 8;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label="Lihat kuota paket"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full border border-slate-200 bg-white py-1.5 pl-1.5 pr-2.5 transition-colors hover:bg-slate-50"
      >
        <span className="relative flex h-5 w-5 items-center justify-center">
          <svg viewBox="0 0 20 20" className="h-5 w-5 -rotate-90">
            <circle cx="10" cy="10" r="8" fill="none" stroke="#e2e8f0" strokeWidth="2" />
            <circle
              cx="10"
              cy="10"
              r="8"
              fill="none"
              stroke={color}
              strokeWidth="2"
              strokeLinecap="round"
              strokeDasharray={`${(ringPct / 100) * circumference} ${circumference}`}
            />
          </svg>
        </span>
        <span className="hidden text-[12px] font-medium text-slate-500 sm:block">Kuota</span>
        <span className="text-[12px] font-semibold tabular-nums" style={{ color }}>
          {maxPct}%
        </span>
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-50 w-72 rounded-xl border border-slate-200 bg-white p-4 shadow-lg">
          <div className="flex items-baseline justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">
              Kuota bulan ini
            </p>
            <p className="text-[12px] font-medium text-slate-700">
              {entitlements.planName ?? "Tanpa paket"}
            </p>
          </div>

          <div className="mt-3 space-y-3">
            {rows.map((r) => {
              const pct = Math.round((r.used / r.limit) * 100);
              const tone = pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-green-600";
              return (
                <div key={r.label}>
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="text-[12px] text-slate-600">{r.label}</p>
                    <p className="font-mono text-[11px] tabular-nums text-slate-500">
                      {r.used.toLocaleString("id-ID")} / {r.limit.toLocaleString("id-ID")}
                    </p>
                  </div>
                  <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full ${tone}`}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {entitlements.billingOverdue && (
            <p className="mt-3 rounded-md bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
              Ada tagihan yang sudah jatuh tempo.
            </p>
          )}

          <Link
            href="/dashboard/plan"
            onClick={() => setOpen(false)}
            className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3 text-[12px] font-medium text-green-700 hover:text-green-800"
          >
            Kelola paket
            <ArrowRight size={13} />
          </Link>
        </div>
      )}
    </div>
  );
}
