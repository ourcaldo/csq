import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { Btn, Empty, PageHead, Section, headFor, TableCard } from "@/components/console";
import { usage } from "@/lib/data";

export const Route = createFileRoute("/plans")({
  head: () => headFor("Paket & Penggunaan", "Paket langganan dan metering penggunaan per tenant."),
  component: Plans,
});

function Plans() {
  return (
    <>
      <PageHead eyebrow="Konfigurasi" title="Paket & Penggunaan" sub="Plan & metering" action={<Btn><Plus className="h-3.5 w-3.5" />Paket baru</Btn>} />
      <Section title="Paket tersedia" meta="0"><Empty title="Belum ada paket" hint="Buat paket pertama untuk mulai menagih tenant." /></Section>
      <Section title="Penggunaan bulan ini" meta="sejak 1 nov">
        <TableCard><table className="ledger">
          <thead><tr><th>Tenant</th><th>Paket</th><th className="text-right">AI</th><th className="text-right">Keluar</th><th className="text-right">Masuk</th><th className="text-right">Media</th></tr></thead>
          <tbody>
            {usage.map((u) => (
              <tr key={u.tenant}>
                <td className="font-medium">{u.tenant}</td>
                <td>
                  <select className="h-7 rounded-sm border border-input bg-card px-2 text-[12.5px] text-muted-foreground">
                    <option>— tanpa paket —</option>
                  </select>
                </td>
                <td className="num text-right">{u.ai}</td>
                <td className="num text-right">{u.out}</td>
                <td className="num text-right">{u.in}</td>
                <td className="num text-right">{u.media}</td>
              </tr>
            ))}
          </tbody>
        </table></TableCard>
      </Section>
    </>
  );
}
