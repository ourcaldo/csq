import { Select } from "@csq/ui/components/ui/select";
import { cn } from "@csq/ui/lib/utils";
import { inputCls } from "./field";
import type { AgentItem } from "./types";

export function AgentPicker(props: {
  agents: AgentItem[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">
        Agent yang Membalas
      </span>
      <Select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        disabled={props.disabled}
        className={cn(inputCls, "md:w-72")}
      >
        {props.agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </Select>
    </label>
  );
}
