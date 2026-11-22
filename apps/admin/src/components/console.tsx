import type { ReactNode } from "react";
import { cn } from "@csq/ui/lib/utils";

// Console primitives for the "Enterprise Control Plane" direction
// (owner-approved template 2026-11-22): white canvas, hairline slate rules,
// mono numerals in divided telemetry strips, emerald as the single action
// color. Ported 1:1 from
// docs/demo/csq_admin_console_enterprise_control_plane.html.

export function StatusLabel({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "bad" | "off";
  children: ReactNode;
}) {
  const dot = {
    ok: "bg-emerald-500",
    warn: "bg-amber-500",
    bad: "bg-red-500",
    off: "bg-slate-300",
  }[tone];
  const text = {
    ok: "text-emerald-700",
    warn: "text-amber-700",
    bad: "text-red-700",
    off: "text-slate-500",
  }[tone];
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-mono text-[11px] font-medium", text)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
      {children}
    </span>
  );
}

// One cell inside a divided telemetry strip (template's bordered grid rows).
export function StatCell({
  label,
  value,
  sub,
  valueClass,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  valueClass?: string;
}) {
  return (
    <div className="py-3.5">
      <p className="text-[11px] font-medium text-slate-400">{label}</p>
      <p className={cn("mt-1 font-mono text-lg font-semibold tabular-nums", valueClass ?? "text-slate-900", valueClass?.includes("text-") ? "" : "")}>
        {value}
      </p>
      {sub ? <p className="mt-0.5 font-mono text-[10px] text-slate-400">{sub}</p> : null}
    </div>
  );
}

// Filled action button (emerald) + outline variant (template's header/form buttons).
export function btnPrimary(extra?: string): string {
  return cn(
    "inline-flex h-9 items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:pointer-events-none disabled:opacity-40",
    extra
  );
}

export function btnOutline(extra?: string): string {
  return cn(
    "inline-flex h-9 items-center rounded-md border border-slate-300 bg-card px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40",
    extra
  );
}

export function btnSmOutline(extra?: string): string {
  return cn(
    "rounded border border-slate-200 bg-card px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:pointer-events-none disabled:opacity-40",
    extra
  );
}

// Section heading (template's uppercase tracking-wider labels).
export function SectionLabel({ children }: { children: ReactNode }) {
  return <h2 className="pb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">{children}</h2>;
}

// Segmented pill filter (template's inline-flex rounded-md bordered group).
export function Segmented({
  options,
  value,
  onChange,
}: {
  options: { key: string; label: string }[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-slate-200 bg-muted p-0.5 text-xs">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          onClick={() => onChange(o.key)}
          className={cn(
            "rounded px-3 py-1 transition",
            value === o.key
              ? "bg-card font-semibold text-slate-900 shadow-sm"
              : "font-medium text-slate-600 hover:text-slate-900"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const pad = (n: number) => String(n).padStart(2, "0");

// Loading skeleton (template direction: neutral pulse, never colored -
// a colored placeholder would flash a fake status before data lands).
export function Skeleton({ className }: { className?: string }) {
  return <span className={`inline-block animate-pulse rounded bg-slate-200/80 ${className ?? ""}`} />;
}

export function idr(n: number): string {
  return "Rp " + Number(n || 0).toLocaleString("id-ID");
}

export function bytes(b: number): string {
  if (!b) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let val = Number(b);
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
