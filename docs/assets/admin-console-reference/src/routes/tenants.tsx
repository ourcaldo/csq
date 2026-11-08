import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { Btn, PageHead, Status, headFor, TableCard } from "@/components/console";
import { tenants } from "@/lib/data";

export const Route = createFileRoute("/tenants")({
  head: () => headFor("Tenant", "Kelola semua tenant di platform CSQ."),
  component: Tenants,
});

function Tenants() {
  return (
    <>
      <PageHead eyebrow="Platform" title="Tenant" sub={`${tenants.length} tenant terdaftar`} action={<Btn><Plus className="h-3.5 w-3.5" />Tenant baru</Btn>} />
      <TableCard><table className="ledger">
        <thead>
          <tr><th>Nama</th><th>Status</th><th className="text-right">Pengguna</th><th className="text-right">Saluran</th><th className="text-right">Percakapan</th><th className="text-right">Pesan 30h</th><th /></tr>
        </thead>
        <tbody>
          {tenants.map((t) => (
            <tr key={t.slug}>
              <td><div className="font-medium">{t.name}</div><div className="text-[12px] text-muted-foreground">{t.slug}</div></td>
              <td><Status tone="ok">Aktif</Status></td>
              <td className="num text-right">{t.users}</td>
              <td className="num text-right">{t.channels}</td>
              <td className="num text-right">{t.conversations}</td>
              <td className="num text-right">{t.messages30d}</td>
              <td className="text-right"><Btn variant="ghost" className="hover:text-primary">Tangguhkan</Btn></td>
            </tr>
          ))}
        </tbody>
      </table></TableCard>
    </>
  );
}
