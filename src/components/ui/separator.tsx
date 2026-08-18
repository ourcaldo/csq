// Thin horizontal/vertical divider. Purely presentational.
import { cn } from "@/lib/utils";

type SeparatorProps = {
  orientation?: "horizontal" | "vertical";
  className?: string;
};

export function Separator({ orientation = "horizontal", className }: SeparatorProps) {
  return (
    <div
      role="separator"
      className={cn(
        "bg-slate-200",
        orientation === "horizontal" ? "h-px w-full" : "h-full w-px",
        className
      )}
    />
  );
}
