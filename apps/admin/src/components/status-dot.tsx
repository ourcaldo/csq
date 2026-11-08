import { cn } from "@csq/ui/lib/utils";

// Status is carried by a dot plus a label, never by color alone.
const TONE = {
  ok: "bg-green-600",
  warn: "bg-amber-500",
  bad: "bg-red-600",
  idle: "bg-slate-300",
} as const;

export function StatusDot({
  tone = "idle",
  className,
}: {
  tone?: keyof typeof TONE;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", TONE[tone], className)}
    />
  );
}
