// Shared loading / error / empty placeholder for list pages. One component,
// three variants — reused across every dashboard section.
import { cn } from "@/lib/utils";

type StateVariant = "loading" | "error" | "empty";

type StateNoticeProps = {
  variant: StateVariant;
  message: string;
  className?: string;
};

const MESSAGES: Record<StateVariant, string> = {
  loading: "Memuat data…",
  error: "Terjadi kesalahan.",
  empty: "Belum ada data.",
};

export function StateNotice({ variant, message, className }: StateNoticeProps) {
  return (
    <div
      className={cn(
        "rounded-md border border-dashed p-8 text-center text-sm",
        variant === "error"
          ? "border-destructive/50 text-destructive"
          : "border-border text-muted-foreground",
        className
      )}
    >
      {message ?? MESSAGES[variant]}
    </div>
  );
}
