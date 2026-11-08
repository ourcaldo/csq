import { Inbox, Send, CheckCircle2, AlertTriangle } from "lucide-react";
import { createFileRoute } from "@tanstack/react-router";
import { Empty, PageHead, Section, Stat, headFor, pad } from "@/components/console";
import { outbox } from "@/lib/data";

export const Route = createFileRoute("/operations")({
  head: () => headFor("Operasional", "Antrean outbox, system locks, perintah saluran, dan sinkronisasi Sheets."),
  component: Ops,
});

function Ops() {
  return (
    <>
      <PageHead eyebrow="Operasi" title="Operasional" sub="Queue, locks & sinkronisasi" />
      <div className="mb-10 grid grid-cols-4 gap-4">
        <Stat icon={Inbox} label="Queued" value={pad(outbox.queued)} />
        <Stat icon={Send} label="Sending" value={pad(outbox.sending)} />
        <Stat icon={CheckCircle2} label="Sent" value={pad(outbox.sent)} />
        <Stat icon={AlertTriangle} label="Failed" value={pad(outbox.failed)} />
      </div>
      <Section title="System locks" meta="0 dipegang"><Empty title="Tidak ada lock yang dipegang" hint="Worker berjalan tanpa kontensi." /></Section>
      <Section title="Perintah saluran terbaru" meta="24 jam"><Empty title="Tidak ada perintah" hint="Perintah connect / disconnect akan muncul di sini." /></Section>
      <Section title="Sinkronisasi Sheets"><Empty title="Tidak ada sumber Google Sheets aktif" /></Section>
    </>
  );
}
