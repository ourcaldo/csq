import type { ReactNode } from "react";
import { ArrowLeft } from "@phosphor-icons/react";
import { Separator } from "@csq/ui/components/ui/separator";

export function ConfigureCard(props: {
  title: string;
  icon: ReactNode;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 p-5">
        <button
          onClick={props.onBack}
          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          aria-label="Kembali"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-600 text-white">
          {props.icon}
        </div>
        <h2 className="text-base font-semibold text-slate-900">{props.title}</h2>
      </div>
      <Separator />
      <div className="p-5">{props.children}</div>
    </div>
  );
}
