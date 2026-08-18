// Toggle switch (capability toggles, settings). Built on a controlled checkbox
// so it stays a native input — no Radix dependency needed.
import type { ChangeEvent } from "react";
import { cn } from "@/lib/utils";

type SwitchProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  className?: string;
};

export function Switch({ checked, onChange, disabled, label, className }: SwitchProps) {
  return (
    <label
      className={cn(
        "inline-flex items-center gap-2",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        className
      )}
    >
      <span className="relative inline-flex h-5 w-9 shrink-0">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          disabled={disabled}
          onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.checked)}
        />
        <span
          className={cn(
            "absolute inset-0 rounded-full transition-colors",
            checked ? "bg-green-600" : "bg-slate-300"
          )}
        />
        <span
          className={cn(
            "absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform",
            checked ? "translate-x-4" : "translate-x-0.5"
          )}
        />
      </span>
      {label && <span className="text-sm text-slate-700">{label}</span>}
    </label>
  );
}
