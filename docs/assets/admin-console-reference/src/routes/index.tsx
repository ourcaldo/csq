import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowUpRight, Inbox, MessageCircle, Send, Store, AlertTriangle, Bot, Download } from "lucide-react";
import { Btn, Card, Group, PageHead, Stat, Status, headFor, pad } from "@/components/console";
import { audit, channels, messages30, outbox, tenants, usage } from "@/lib/data";

export const Route = createFileRoute("/")({
  head: () => headFor("Ringkasan", "Ringkasan kesehatan platform CSQ: tenant, saluran, pesan, dan antrean."),
  component: Overview,
});

function Chart() {
  const max = Math.max(...messages30);
  const top = Math.ceil(max / 8) * 8;
  const ticks = [top, (top * 3) / 4, top / 2, top / 4, 0];
  const peak = messages30.indexOf(max);
  const H = 180;
  return (
    <div className="flex gap-3">
      <div className="mono flex flex-col justify-between pb-7 text-right text-[10.5px] text-muted-foreground" style={{ height: H + 28 }}>
        {ticks.map((t) => <span key={t} className="leading-none">{t}</span>)}
      </div>
      <div className="relative flex-1">
        <div className="absolute inset-x-0 top-0 flex flex-col justify-between" style={{ height: H }}>
          {ticks.map((t) => <div key={t} className="border-t border-dashed border-border" />)}
        </div>
        <div className="relative flex items-end gap-1.5" style={{ height: H }}>
          {messages30.map((v, i) => (
            <div key={i} className="group relative flex h-full flex-1 items-end">
              <div
                className={`w-full rounded-full transition-colors ${i === peak ? "bg-foreground" : "bg-muted ring-1 ring-border/60 group-hover:bg-foreground/70"}`}
                style={{ height: Math.max(10, (v / top) * H) }}
              />
              <span className="mono pointer-events-none absolute -top-7 left-1/2 hidden -translate-x-1/2 rounded-md bg-foreground px-1.5 py-0.5 text-[10.5px] text-background group-hover:block">
                {v}
              </span>
            </div>
          ))}
        </div>
        <div className="mono mt-2 flex gap-1.5 text-[10px] text-muted-foreground">
          {messages30.map((_, i) => (
            <span key={i} className={`flex-1 text-center ${i % 3 === 0 ? "" : "invisible"}`}>{(i + 10 - 1) % 31 + 1}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

function Overview() {
  const total = messages30.reduce((a, b) => a + b, 0);
  const connected = channels.filter((c) => c.status !== "disconnected").length;
  const u = usage[0]!;
  return (
    <>
      <PageHead
        eyebrow="Selamat malam"
        title="Platform Operator, ini kondisi CSQ"
        sub="Sekilas hari ini, dan bagaimana 30 hari terakhir berjalan."
        action={<><Btn variant="line"><Download className="h-3.5 w-3.5" />Ekspor</Btn><Btn>Tenant baru</Btn></>}
      />

      <div className="mb-4 grid grid-cols-4 gap-4">
        <Stat icon={Store} label="Tenant aktif" value={pad(tenants.length)} note="0 ditangguhkan" />
        <Stat icon={MessageCircle} label="Saluran" value={pad(channels.length)} note={`${connected} terhubung · ${channels.length - connected} terputus`} />
        <Stat icon={Inbox} label="Antrean" value={pad(outbox.queued)} note={`${outbox.sending} sedang dikirim`} />
        <Stat icon={AlertTriangle} label="Gagal kirim" value={pad(outbox.failed)} note="Outbox worker sehat" />
      </div>

      <Group label="30 hari terakhir">
        <div className="grid grid-cols-3 gap-4">
          <Stat icon={Send} label="Pesan" value={total} trend={42} note={<><span className="text-foreground">{tenants[0]?.conversations ?? 0}</span> percakapan dilayani</>} />
          <Stat icon={Bot} label="Balasan AI" value={pad(u.ai)} trend={-12} note={<><span className="text-foreground">{u.out}</span> pesan keluar, <span className="text-foreground">{u.in}</span> masuk</>} />
          <Stat icon={Inbox} label="Media" value={u.media} note="Total penyimpanan media bulan ini" />
        </div>
      </Group>

      <Card className="mb-4 p-5">
        <div className="mb-5 flex items-center justify-between">
          <span className="eyebrow text-foreground">Pesan per hari</span>
          <span className="mono text-[11.5px] text-muted-foreground">{total} pesan dalam periode</span>
        </div>
        <Chart />
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
            <span className="eyebrow text-foreground">Perlu perhatian</span>
            <Link to="/channels" className="flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-foreground">Semua saluran <ArrowUpRight className="h-3.5 w-3.5" /></Link>
          </div>
          {channels.map((c) => (
            <div key={c.provider} className="flex items-center gap-3 border-b border-border px-5 py-3 last:border-0">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-muted ring-1 ring-border"><MessageCircle className="h-3.5 w-3.5" strokeWidth={1.75} /></span>
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-medium">{c.tenant}</div>
                <div className="mono text-[11.5px] text-muted-foreground">{c.provider}</div>
              </div>
              <Status tone="bad">Terputus</Status>
            </div>
          ))}
        </Card>
        <Card>
          <div className="flex items-center justify-between border-b border-border px-5 py-3.5">
            <span className="eyebrow text-foreground">Aktivitas terbaru</span>
            <Link to="/audit" className="flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-foreground">Log audit <ArrowUpRight className="h-3.5 w-3.5" /></Link>
          </div>
          {audit.slice(4, 8).map((e, i) => (
            <div key={i} className="flex items-center gap-3 border-b border-border px-5 py-3 last:border-0">
              <span className={`h-1.5 w-1.5 rounded-full ${e.action.includes("error") ? "bg-bad" : "bg-muted-foreground/50"}`} />
              <span className="mono flex-1 truncate text-[12.5px]">{e.action}</span>
              <span className="mono text-[11.5px] text-muted-foreground">{e.time.slice(11, 16)}</span>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}
