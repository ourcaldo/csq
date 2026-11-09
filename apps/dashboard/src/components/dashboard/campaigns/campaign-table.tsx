import type { CampaignRow } from "@csq/core/types/campaign";
import { Badge } from "@csq/ui/components/ui/badge";
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

export function CampaignTable(props: {
  items: CampaignRow[];
  loading: boolean;
  error: string | null;
  canManage: boolean;
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
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nama</TableHead>
            <TableHead className="hidden md:table-cell">Penerima</TableHead>
            <TableHead className="hidden lg:table-cell">Jadwal</TableHead>
            <TableHead className="hidden xl:table-cell">Kirim berikutnya</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Aksi</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.items.length === 0 && (
            <TableRow>
              <TableCell colSpan={6}>
                <StateNotice variant="empty" message="Belum ada kampanye." />
              </TableCell>
            </TableRow>
          )}
          {props.items.map((c) => (
            <TableRow key={c.id}>
              <TableCell className="font-medium">{c.name}</TableCell>
              <TableCell className="hidden md:table-cell">{audienceLabel(c)}</TableCell>
              <TableCell className="hidden text-muted-foreground lg:table-cell">
                {scheduleLabel(c)}
              </TableCell>
              <TableCell className="hidden text-muted-foreground xl:table-cell">
                {formatDateTime(c.nextRunAt)}
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    c.status === "ACTIVE"
                      ? "success"
                      : c.status === "PAUSED"
                        ? "warning"
                        : "secondary"
                  }
                >
                  {c.status}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                {props.canManage && (
                  <div className="flex flex-wrap justify-end gap-1">
                    <Button variant="outline" size="sm" onClick={() => props.onRuns(c)}>
                      Riwayat
                    </Button>
                    {c.status === "DRAFT" || c.status === "PAUSED" ? (
                      <>
                        <Button variant="outline" size="sm" onClick={() => props.onEdit(c)}>
                          Edit
                        </Button>
                        <Button size="sm" onClick={() => props.onActivate(c)}>
                          Aktifkan
                        </Button>
                      </>
                    ) : c.status === "ACTIVE" ? (
                      <Button variant="outline" size="sm" onClick={() => props.onPause(c)}>
                        Jeda
                      </Button>
                    ) : null}
                    {(c.status === "DRAFT" || c.status === "PAUSED") && (
                      <Button variant="destructive" size="sm" onClick={() => props.onDelete(c)}>
                        Hapus
                      </Button>
                    )}
                  </div>
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
