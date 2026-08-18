// Status badge with semantic tones for order/agent/channel/source states.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type BadgeStatusProps = {
  children: ReactNode;
  tone?: "neutral" | "green" | "blue" | "amber" | "red";
  className?: string;
};

const TONE: Record<NonNullable<BadgeStatusProps["tone"]>, string> = {
  neutral: "bg-slate-100 text-slate-700",
  green: "bg-green-100 text-green-700",
  blue: "bg-blue-100 text-blue-700",
  amber: "bg-amber-100 text-amber-700",
  red: "bg-red-100 text-red-700",
};

export function BadgeStatus({ children, tone = "neutral", className }: BadgeStatusProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium",
        TONE[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
