import { CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { cn } from "@csq/ui/lib/utils";
import type { ToastState } from "./types";

export function Toast({ toast }: { toast: ToastState | null }) {
  if (!toast) return null;
  return (
    <div
      className={cn(
        "fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg",
        toast.tone === "success" ? "bg-green-600" : "bg-red-600"
      )}
      role="status"
    >
      {toast.tone === "success" ? (
        <CheckCircle size={18} weight="fill" />
      ) : (
        <WarningCircle size={18} weight="fill" />
      )}
      {toast.msg}
    </div>
  );
}
