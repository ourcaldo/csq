import type { CampaignMessageRow, CampaignRunRow } from "@csq/core/types/campaign";
import { Button } from "@csq/ui/components/ui/button";
import { Dialog } from "@csq/ui/components/ui/dialog";
import { StateNotice } from "@/components/dashboard/state-notice";
import { formatDateTime } from "./format";

export function CampaignRunsDialog(props: {
  open: boolean;
  title: string;
  runs: CampaignRunRow[] | null;
  runDetail: CampaignRunRow | null;
  onClose: () => void;
  onToggleDetail: (id: string) => void;
}) {
  return (
    <Dialog open={props.open} onClose={props.onClose} title={props.title}>
      <div className="max-h-[60vh] space-y-3 overflow-y-auto">
        {props.runs === null && (
          <StateNotice variant="loading" message="Memuat riwayat..." />
        )}
        {props.runs !== null && props.runs.length === 0 && (
          <StateNotice variant="empty" message="Belum pernah kirim." />
        )}
        {props.runs?.map((r) => (
          <div key={r.id} className="rounded-md border p-3 text-sm">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">{formatDateTime(r.startedAt)}</p>
                <p className="text-xs text-muted-foreground">
                  {r.finishedAt
                    ? `Selesai ${formatDateTime(r.finishedAt)}`
                    : "Sedang berjalan"}{" "}
                  - total {r.counts?.total ?? 0}, terkirim {r.counts?.sent ?? 0}, gagal{" "}
                  {r.counts?.failed ?? 0}, dilewati {r.counts?.skipped ?? 0}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  props.runDetail?.id === r.id
                    ? props.onToggleDetail(r.id)
                    : props.onToggleDetail(r.id)
                }
              >
                {props.runDetail?.id === r.id ? "Tutup" : "Detail"}
              </Button>
            </div>
            {props.runDetail?.id === r.id && (
              <div className="mt-3 max-h-48 overflow-y-auto rounded border">
                {props.runDetail.messages?.length === 0 && (
                  <p className="p-2 text-xs text-muted-foreground">Tidak ada pesan.</p>
                )}
                {props.runDetail.messages?.map((m: CampaignMessageRow) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between border-b px-2 py-1 text-xs last:border-b-0"
                  >
                    <span className="font-mono">{m.phone}</span>
                    <span
                      className={
                        m.status === "SENT"
                          ? "text-green-600"
                          : m.status === "FAILED"
                            ? "text-destructive"
                            : m.status === "SKIPPED"
                              ? "text-amber-600"
                              : "text-muted-foreground"
                      }
                    >
                      {m.status === "PENDING" ? "menunggu" : m.status.toLowerCase()}
                      {m.reason ? ` - ${m.reason}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </Dialog>
  );
}
