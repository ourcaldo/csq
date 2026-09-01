import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import type { NodeProps } from "@xyflow/react";
import { cn } from "@/lib/utils";

// Custom React Flow node renderers for the scenario builder. Each shows a
// compact card with its config summary and the appropriate handles. Horizontal
// flow: target on the left, source on the right. Condition branches into a
// "true" (top-right) and "false" (bottom-right) handle so the two outgoing
// edges are visually distinct.
//
// Node `data` is React Flow's Record<string, unknown>; fields are read with
// safe coercion (no `as`) and rendered as plain text.

const NODE_TONE: Record<string, string> = {
  trigger: "border-green-500 bg-green-50",
  send: "border-blue-500 bg-blue-50",
  wait: "border-amber-500 bg-amber-50",
  condition: "border-violet-500 bg-violet-50",
  tag: "border-slate-400 bg-slate-50",
  end: "border-slate-700 bg-slate-100",
  ai: "border-teal-500 bg-teal-50",
  setStage: "border-indigo-500 bg-indigo-50",
  assign: "border-orange-500 bg-orange-50",
  email: "border-cyan-600 bg-cyan-50",
};

const NODE_TITLE: Record<string, string> = {
  trigger: "Pemicu",
  send: "Kirim Pesan",
  wait: "Tunggu",
  condition: "Kondisi (IF)",
  tag: "Tag",
  end: "Selesai",
  ai: "Pesan AI",
  setStage: "Tahap Deal",
  assign: "Tugaskan",
  email: "Email",
};

function NodeShell({
  type,
  selected,
  children,
}: {
  type: string;
  selected?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "w-56 rounded-lg border-2 px-3 py-2 text-xs shadow-sm",
        NODE_TONE[type] ?? "border-slate-300 bg-white",
        selected ? "ring-2 ring-offset-1 ring-slate-400" : ""
      )}
    >
      <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-600">
        {NODE_TITLE[type] ?? type}
      </p>
      {children}
    </div>
  );
}

function str(v: unknown): string {
  return typeof v === "string" ? v : v === undefined || v === null ? "" : String(v);
}

export const TriggerNode = memo(function TriggerNode({ data, selected }: NodeProps) {
  const triggerType = str(data?.triggerType);
  const label =
    triggerType === "ON_NEW_CONVERSATION"
      ? "Percakapan baru"
      : triggerType === "ON_PURCHASE"
        ? "Pesanan dibuat"
        : triggerType === "ON_TAG_ADDED"
          ? `Tag: ${str(data?.tagName) || "?"}`
          : "—";
  return (
    <NodeShell type="trigger" selected={selected}>
      <Handle type="target" position={Position.Left} isConnectable={false} />
      <p className="text-slate-800">{label}</p>
      <Handle type="source" position={Position.Right} id={undefined} />
    </NodeShell>
  );
});

export const SendNode = memo(function SendNode({ data, selected }: NodeProps) {
  const body = str(data?.body);
  return (
    <NodeShell type="send" selected={selected}>
      <Handle type="target" position={Position.Left} />
      <p className="line-clamp-3 break-words text-slate-800">{body || "(pesan kosong)"}</p>
      <Handle type="source" position={Position.Right} />
    </NodeShell>
  );
});

export const WaitNode = memo(function WaitNode({ data, selected }: NodeProps) {
  const ms = typeof data?.durationMs === "number" ? data.durationMs : 0;
  const label =
    ms >= 60 * 60 * 1000
      ? `${Math.round(ms / (60 * 60 * 1000))} jam`
      : ms >= 60 * 1000
        ? `${Math.round(ms / (60 * 1000))} menit`
        : `${ms} ms`;
  return (
    <NodeShell type="wait" selected={selected}>
      <Handle type="target" position={Position.Left} />
      <p className="text-slate-800">Tunggu {label}</p>
      <Handle type="source" position={Position.Right} />
    </NodeShell>
  );
});

export const ConditionNode = memo(function ConditionNode({ data, selected }: NodeProps) {
  const field = str(data?.field);
  const op = str(data?.operator);
  const value = str(data?.value);
  return (
    <NodeShell type="condition" selected={selected}>
      <Handle type="target" position={Position.Left} />
      <p className="break-words text-slate-800">
        {field || "?"} {op} {value}
      </p>
      <div className="mt-1 flex justify-between text-[10px] font-semibold text-slate-500">
        <span>true ↓</span>
        <span>false ↓</span>
      </div>
      <Handle type="source" position={Position.Right} id="true" style={{ top: "auto", bottom: 6 }} />
      <Handle type="source" position={Position.Right} id="false" style={{ top: 6 }} />
    </NodeShell>
  );
});

export const TagNode = memo(function TagNode({ data, selected }: NodeProps) {
  return (
    <NodeShell type="tag" selected={selected}>
      <Handle type="target" position={Position.Left} />
      <p className="text-slate-800">+ {str(data?.tagName) || "(tag?)"}</p>
      <Handle type="source" position={Position.Right} />
    </NodeShell>
  );
});

export const EndNode = memo(function EndNode({ selected }: NodeProps) {
  return (
    <NodeShell type="end" selected={selected}>
      <Handle type="target" position={Position.Left} />
      <p className="text-slate-600">Akhir alur</p>
    </NodeShell>
  );
});

export const AiNode = memo(function AiNode({ data, selected }: NodeProps) {
  const prompt = str(data?.prompt);
  return (
    <NodeShell type="ai" selected={selected}>
      <Handle type="target" position={Position.Left} />
      <p className="line-clamp-3 break-words text-slate-800">
        {prompt ? `✨ ${prompt}` : "(prompt kosong)"}
      </p>
      <p className="mt-1 text-[10px] text-slate-500">dikirim via AI + WhatsApp</p>
      <Handle type="source" position={Position.Right} />
    </NodeShell>
  );
});

export const SetStageNode = memo(function SetStageNode({ data, selected }: NodeProps) {
  const stageName = str(data?.stageName);
  return (
    <NodeShell type="setStage" selected={selected}>
      <Handle type="target" position={Position.Left} />
      <p className="text-slate-800">→ {stageName || "(tahap?)"}</p>
      <Handle type="source" position={Position.Right} />
    </NodeShell>
  );
});

export const AssignNode = memo(function AssignNode({ data, selected }: NodeProps) {
  const name = str(data?.userName);
  return (
    <NodeShell type="assign" selected={selected}>
      <Handle type="target" position={Position.Left} />
      <p className="truncate text-slate-800">👤 {name || "(anggota tim?)"}</p>
      <Handle type="source" position={Position.Right} />
    </NodeShell>
  );
});

export const EmailNode = memo(function EmailNode({ data, selected }: NodeProps) {
  const subject = str(data?.subject);
  return (
    <NodeShell type="email" selected={selected}>
      <Handle type="target" position={Position.Left} />
      <p className="line-clamp-2 break-words text-slate-800">
        ✉️ {subject || "(subjek kosong)"}
      </p>
      <Handle type="source" position={Position.Right} />
    </NodeShell>
  );
});

export const nodeTypes = {
  trigger: TriggerNode,
  send: SendNode,
  wait: WaitNode,
  condition: ConditionNode,
  tag: TagNode,
  end: EndNode,
  ai: AiNode,
  setStage: SetStageNode,
  assign: AssignNode,
  email: EmailNode,
};
