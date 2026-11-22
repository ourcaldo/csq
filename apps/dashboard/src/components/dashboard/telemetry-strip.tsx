// Telemetry strip used by the Produk and Pesanan enterprise pages
// (template 2026-11-22): a full-width hairline band with 4 metrics - label
// small and muted, value in mono. Purely presentational; the pages compute
// the numbers.
import { cn } from "@csq/ui/lib/utils";

export type TelemetryCell = {
  label: string;
  value: string;
  /** Tailwind color class for the value, defaults to slate-900. */
  valueClass?: string;
};

export function TelemetryStrip({ cells }: { cells: TelemetryCell[] }) {
  return (
    <div className="mt-6 grid grid-cols-2 border-y border-slate-200 sm:grid-cols-4 sm:divide-x sm:divide-slate-200">
      {cells.map((c, i) => (
        <div
          key={c.label}
          className={cn(
            "py-3.5",
            i === 0 && "pr-4",
            i > 0 && i < cells.length - 1 && "sm:px-5",
            i > 0 && i % 2 === 0 && "border-t border-slate-200 sm:border-t-0",
            i === cells.length - 1 && "sm:pl-5",
            i % 2 === 1 && "sm:px-5"
          )}
        >
          <p className="text-xs font-medium text-slate-400">{c.label}</p>
          <p
            className={cn(
              "mt-1 font-mono text-lg font-semibold tabular-nums",
              c.valueClass ?? "text-slate-900"
            )}
          >
            {c.value}
          </p>
        </div>
      ))}
    </div>
  );
}
