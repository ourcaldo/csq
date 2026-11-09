import { PaperPlaneRight } from "@phosphor-icons/react";
import { Button } from "@csq/ui/components/ui/button";
import { cn } from "@csq/ui/lib/utils";
import { inputCls } from "./field";

export function TestBox(props: {
  id: string;
  testTo: Record<string, string>;
  testing: string | null;
  onTo: (v: string) => void;
  onTest: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
        <PaperPlaneRight size={14} /> Kirim Pesan Test
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={props.testTo[props.id] ?? ""}
          onChange={(e) => props.onTo(e.target.value)}
          disabled={props.disabled}
          className={cn(inputCls, "sm:flex-1")}
        />
        <Button
          size="sm"
          variant="outline"
          className="w-full sm:w-auto"
          disabled={props.disabled || props.testing === props.id}
          onClick={props.onTest}
        >
          {props.testing === props.id ? "Mengirim..." : "Test"}
        </Button>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Nomor tujuan format internasional, mis. 62812xxxxxxx
      </p>
    </div>
  );
}
