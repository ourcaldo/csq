import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Empty, PageHead, headFor, TableCard } from "@/components/console";
import { audit } from "@/lib/data";

export const Route = createFileRoute("/audit")({
  head: () => headFor("Audit", "Log aktivitas tenant dan aksi admin di platform CSQ."),
  component: Audit,
});

function verbTone(a: string) {
  if (a.includes("error")) return "text-bad";
  if (a.startsWith("campaign")) return "text-foreground";
  return "text-muted-foreground";
}

function Audit() {
  const [tab, setTab] = useState<"tenant" | "admin">("tenant");
  return (
    <>
      <PageHead
        eyebrow="Operasi"
        title="Audit"
        sub="Log aktivitas, terbaru di atas"
        action={
          <div className="flex rounded-full bg-card p-1 ring-1 ring-border">
            {(["tenant", "admin"] as const).map((t) => (
              <button key={t} onClick={() => setTab(t)} className={`rounded-full px-3 py-1 text-[13px] transition-colors ${tab === t ? "bg-foreground font-medium text-background" : "hover:bg-accent"}`}>
                {t === "tenant" ? "Aktivitas tenant" : "Aksi admin"}
              </button>
            ))}
          </div>
        }
      />
      {tab === "admin" ? (
        <Empty title="Belum ada aksi admin" hint="Setiap perubahan oleh operator tercatat di sini." />
      ) : (
        <TableCard><table className="ledger">
          <thead><tr><th className="w-44">Waktu</th><th>Aksi</th><th>Entitas</th><th>Tenant</th></tr></thead>
          <tbody>
            {audit.map((e, i) => (
              <tr key={i}>
                <td className="num text-[13px] text-muted-foreground">{e.time}</td>
                <td className={`mono text-[12.5px] ${verbTone(e.action)}`}>
                  <span className="text-muted-foreground">{e.action.split(".")[0]}.</span>{e.action.split(".")[1]}
                </td>
                <td className="text-[12.5px]">{e.entity} <span className="mono text-muted-foreground">#{e.id}</span></td>
                <td className="text-[12.5px] text-muted-foreground">{e.tenant}</td>
              </tr>
            ))}
          </tbody>
        </table></TableCard>
      )}
    </>
  );
}
