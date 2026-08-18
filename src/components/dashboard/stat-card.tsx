// KPI / stat tile for the overview page. A label, a big number, an optional
// delta or hint, and an icon chip — matches the reference's compact summary cards.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type StatCardProps = {
  label: string;
  value: string | number;
  hint?: string;
  icon?: ReactNode;
  tone?: "default" | "green" | "blue" | "amber";
};

const TONE: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "bg-slate-100 text-slate-600",
  green: "bg-green-100 text-green-700",
  blue: "bg-blue-100 text-blue-700",
  amber: "bg-amber-100 text-amber-700",
};

export function StatCard({ label, value, hint, icon, tone = "default" }: StatCardProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{label}</p>
        {icon && (
          <div className={cn("flex h-9 w-9 items-center justify-center rounded-lg", TONE[tone])}>
            {icon}
          </div>
        )}
      </div>
      <p className="mt-3 text-2xl font-bold text-slate-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}
