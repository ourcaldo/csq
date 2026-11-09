import { Pause, Power, Robot } from "@phosphor-icons/react";

export function AgentKpiRow({
  active,
  paused,
  draft,
}: {
  active: number;
  paused: number;
  draft: number;
}) {
  return (
    <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Agent Aktif
          </p>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-100 text-green-700">
            <Power size={18} />
          </div>
        </div>
        <p className="mt-3 text-2xl font-bold text-slate-900">{active}</p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Dijeda
          </p>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
            <Pause size={18} />
          </div>
        </div>
        <p className="mt-3 text-2xl font-bold text-slate-900">{paused}</p>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Draf
          </p>
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
            <Robot size={18} />
          </div>
        </div>
        <p className="mt-3 text-2xl font-bold text-slate-900">{draft}</p>
      </div>
    </div>
  );
}
