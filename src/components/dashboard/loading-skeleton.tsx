// Skeleton shimmer for loading states. `rows` renders a table-shaped stack;
// otherwise renders `count` generic bars.
import { cn } from "@/lib/utils";

type LoadingSkeletonProps = {
  rows?: number;
  count?: number;
  className?: string;
};

export function LoadingSkeleton({ rows, count = 3, className }: LoadingSkeletonProps) {
  if (rows) {
    return (
      <div className={cn("space-y-2", className)}>
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />
        ))}
      </div>
    );
  }
  return (
    <div className={cn("space-y-3", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="h-4 animate-pulse rounded bg-slate-100" />
      ))}
    </div>
  );
}
