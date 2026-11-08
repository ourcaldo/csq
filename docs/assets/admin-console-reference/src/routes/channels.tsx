import { createFileRoute } from "@tanstack/react-router";
import { RotateCw, Power } from "lucide-react";
import { Btn, PageHead, Status, Tag, headFor, TableCard } from "@/components/console";
import { channels } from "@/lib/data";

export const Route = createFileRoute("/channels")({
  head: () => headFor("Saluran", "Armada saluran WhatsApp per tenant: status koneksi dan lease."),
  component: Channels,
});

function Channels() {
  return (
    <>
      <PageHead eyebrow="Platform" title="Saluran" sub="Channel fleet · 0 dari 2 terhubung" action={<Btn variant="line"><RotateCw className="h-3.5 w-3.5" />Sambung ulang semua</Btn>} />
      <TableCard><table className="ledger">
        <thead><tr><th>Tenant</th><th>Provider</th><th>Status</th><th>Lease</th><th className="text-right">Aksi</th></tr></thead>
        <tbody>
          {channels.map((c) => (
            <tr key={c.provider}>
              <td><div className="font-medium">{c.tenant}</div><div className="text-[12px] text-muted-foreground">{c.slug}</div></td>
              <td><Tag>{c.provider}</Tag></td>
              <td><Status tone="bad">Terputus</Status></td>
              <td className="num text-muted-foreground">{c.lease ?? "—"}</td>
              <td className="text-right">
                <Btn variant="ghost" aria-label="Sambung ulang"><RotateCw className="h-3.5 w-3.5" /></Btn>
                <Btn variant="ghost" aria-label="Matikan" className="hover:text-primary"><Power className="h-3.5 w-3.5" /></Btn>
              </td>
            </tr>
          ))}
        </tbody>
      </table></TableCard>
    </>
  );
}
