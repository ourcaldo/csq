import { createFileRoute } from "@tanstack/react-router";
import { Empty, PageHead, headFor } from "@/components/console";

export const Route = createFileRoute("/api-keys")({
  head: () => headFor("Kunci API", "Token dan integrasi API milik tenant."),
  component: Keys,
});

function Keys() {
  return (
    <>
      <PageHead eyebrow="Konfigurasi" title="Kunci API" sub="Token & integrasi" action={<div className="num flex gap-5 text-[12px]"><span>0 aktif</span><span className="text-muted-foreground">0 dicabut</span></div>} />
      <Empty title="Belum ada kunci API" hint="Tenant membuat kunci dari dashboard mereka sendiri." />
    </>
  );
}
