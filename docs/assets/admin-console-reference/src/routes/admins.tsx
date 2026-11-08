import { createFileRoute } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { Btn, PageHead, headFor, TableCard } from "@/components/console";
import { admins } from "@/lib/data";

export const Route = createFileRoute("/admins")({
  head: () => headFor("Admin", "Kelola operator platform CSQ."),
  component: Admins,
});

function Admins() {
  return (
    <>
      <PageHead eyebrow="Konfigurasi" title="Admin" sub="Operator platform" action={<Btn><Plus className="h-3.5 w-3.5" />Admin baru</Btn>} />
      <TableCard><table className="ledger">
        <thead><tr><th>Operator</th><th>Email</th><th>Sejak</th><th /></tr></thead>
        <tbody>
          {admins.map((a) => (
            <tr key={a.email}>
              <td className="font-medium">{a.name} {a.you && <span className="ml-2 rounded-full bg-signal-soft px-2 py-0.5 text-[11px] font-semibold text-primary">Anda</span>}</td>
              <td className="text-[13px]">{a.email}</td>
              <td className="num text-[12.5px] text-muted-foreground">{a.since}</td>
              <td className="text-right"><Btn variant="ghost">Kelola</Btn></td>
            </tr>
          ))}
        </tbody>
      </table></TableCard>
    </>
  );
}
