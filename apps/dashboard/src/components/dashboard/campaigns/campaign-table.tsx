import {
  CloudCheck,
  Megaphone,
  Pause,
  PencilSimple,
  Play,
  Trash,
  WhatsappLogo,
} from "@phosphor-icons/react";
import type { CampaignRow } from "@csq/core/types/campaign";
import { Button } from "@csq/ui/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@csq/ui/components/ui/table";
import { StateNotice } from "@/components/dashboard/state-notice";
import { audienceLabel, formatDateTime, scheduleLabel } from "./format";
import { cn } from "@csq/ui/lib/utils";

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string; dot: string }> = {
    ACTIVE: { cls: "bg-green-100 text-green-700", label: "Aktif", dot: "bg-green-600" },
    PAUSED: { cls: "bg-amber-100 text-amber-700", label: "Dijeda", dot: "bg-amber-500" },
    COMPLETED: { cls: "bg-blue-100 text-blue-700", label: "Selesai", dot: "bg-blue-500" },
    DRAFT: { cls: "bg-slate-100 text-slate-600", label: "Draf", dot: "bg-slate-400" },
  };
  const s = map[status] ?? map.DRAFT;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
        s.cls
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}

export function CampaignTable(props: {
  items: CampaignRow[];
  loading: boolean;
  error: string | null;
  canManage: boolean;
  channelLabels: Record<string, { label: string; provider: string }>;
  onRuns: (c: CampaignRow) => void;
  onEdit: (c: CampaignRow) => void;
  onActivate: (c: CampaignRow) => void;
  onPause: (c: CampaignRow) => void;
  onDelete: (c: CampaignRow) => void;
}) {
  if (props.loading) {
    return <StateNotice variant="loading" message="Memuat kampanye..." />;
  }
  if (props.error) {
    return <StateNotice variant="error" message={props.error} />;
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50/80">
            <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Kampanye &amp; Saluran
            </TableHead>
            <TableHead className="hidden text-[11px] font-semibold uppercase tracking-wider text-slate-500 md:table-cell">
              Penerima
            </TableHead>
            <TableHead className="hidden text-[11px] font-semibold uppercase tracking-wider text-slate-500 lg:table-cell">
              Jadwal
            </TableHead>
            <TableHead className="hidden text-[11px] font-semibold uppercase tracking-wider text-slate-500 xl:table-cell">
              Kirim Berikutnya
            </TableHead>
            <TableHead className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Status
            </TableHead>
            <TableHead className="text-right text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Aksi
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.items.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="px-4 py-14 text-center">
                <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                  <Megaphone size={20} />
                </div>
                <p className="mt-3 text-sm font-semibold text-slate-900">Tidak ada kampanye</p>
                <p className="mt-1 text-xs text-slate-500">
                  Buat kampanye baru atau ubah filter status di atas.
                </p>
              </TableCell>
            </TableRow>
          )}
          {props.items.map((c) => {
            const ch = props.channelLabels[c.channelId];
            return (
              <TableRow key={c.id} className="transition-colors hover:bg-slate-50/80">
                <TableCell className="px-4 py-3.5">
                  <p className="text-sm font-semibold text-slate-900">{c.name}</p>
                  <div className="mt-0.5 flex items-center gap-2">
                    {ch ? (
                      <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                        {ch.provider === "CLOUD_API" ? (
                          <CloudCheck size={13} className="text-blue-600" />
                        ) : (
                          <WhatsappLogo size={13} className="text-green-600" />
                        )}
                        {ch.label}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">Tanpa saluran</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="hidden px-4 py-3.5 text-xs font-medium text-slate-700 md:table-cell">
                  {audienceLabel(c)}
                </TableCell>
                <TableCell className="hidden px-4 py-3.5 text-xs text-slate-500 lg:table-cell">
                  {scheduleLabel(c)}
                </TableCell>
                <TableCell className="hidden px-4 py-3.5 font-mono text-xs tabular-nums text-slate-500 xl:table-cell">
                  {formatDateTime(c.nextRunAt)}
                </TableCell>
                <TableCell className="px-4 py-3.5">
                  <StatusBadge status={c.status} />
                </TableCell>
                <TableCell className="px-4 py-3.5 text-right">
                  {props.canManage && (
                    <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                      <button
                        onClick={() => props.onRuns(c)}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                      >
                        Riwayat
                      </button>
                      {c.status === "DRAFT" || c.status === "PAUSED" ? (
                        <>
                          <button
                            onClick={() => props.onEdit(c)}
                            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                          >
                            <PencilSimple size={12} className="text-slate-500" /> Edit
                          </button>
                          <button
                            onClick={() => props.onActivate(c)}
                            className="inline-flex items-center gap-1 rounded-lg bg-green-600 px-2.5 py-1.5 text-xs font-semibold text-white transition hover:bg-green-700"
                          >
                            <Play size={10} weight="fill" /> Aktifkan
                          </button>
                          <button
                            onClick={() => props.onDelete(c)}
                            title="Hapus kampanye"
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash size={14} />
                          </button>
                        </>
                      ) : c.status === "ACTIVE" ? (
                        <button
                          onClick={() => props.onPause(c)}
                          className="inline-flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs font-semibold text-amber-700 transition hover:bg-amber-100"
                        >
                          <Pause size={10} weight="fill" /> Jeda
                        </button>
                      ) : null}
                    </div>
                  )}
                </TableCell>
            </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
