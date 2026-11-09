import type { ReactNode } from "react";
import { Check } from "@phosphor-icons/react";
import { Button } from "@csq/ui/components/ui/button";
import { cn } from "@csq/ui/lib/utils";

export function MethodCard(props: {
  icon: ReactNode;
  tone: "green" | "slate";
  title: string;
  subtitle: string;
  points: string[];
  ctaLabel: string;
  disabled?: boolean;
  onChoose: () => void;
}) {
  const iconWrap =
    props.tone === "green" ? "bg-green-600 text-white" : "bg-slate-800 text-white";
  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-lg",
            iconWrap
          )}
        >
          {props.icon}
        </div>
        <div>
          <h3 className="text-base font-semibold text-slate-900">{props.title}</h3>
          <p className="text-sm text-slate-500">{props.subtitle}</p>
        </div>
      </div>
      <ul className="mt-4 flex-1 space-y-2">
        {props.points.map((p) => (
          <li key={p} className="flex items-start gap-2 text-sm text-slate-600">
            <Check
              size={16}
              weight="bold"
              className="mt-0.5 shrink-0 text-green-600"
            />
            {p}
          </li>
        ))}
      </ul>
      <div className="mt-5">
        <Button className="w-full" disabled={props.disabled} onClick={props.onChoose}>
          {props.ctaLabel}
        </Button>
      </div>
    </div>
  );
}
