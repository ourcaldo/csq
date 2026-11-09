// FEA-9 (PRD 16): public getting-started page. Renders the README
// self-hosted deployment steps as sections, commands verbatim from README.md.
// Styling follows the landing (apps/web local classes: font-display,
// font-mono-data, slate/green palette, numbered section rows like HowItWorks).
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ChatCircleDots } from "@phosphor-icons/react";
import { Seo } from "@csq/ui/components/seo";

const DESCRIPTION =
  "Panduan singkat memasang CSQ di server Anda sendiri: kloning repositori, menyiapkan environment dan database, menjalankan stack Docker, sampai deploy di VPS.";

function CodeBlock({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl bg-slate-900 p-4 font-mono-data text-[13px] leading-relaxed text-slate-100">
      {children}
    </pre>
  );
}

function Section({ n, title, children }: { n?: string; title: string; children: ReactNode }) {
  return (
    <section className="grid gap-5 py-10 md:grid-cols-[auto_1fr] md:gap-10">
      {n && (
        <p className="font-display text-4xl font-extrabold tracking-tight text-green-700/25">{n}</p>
      )}
      <div className="min-w-0">
        <h2 className="font-display text-xl font-bold tracking-tight md:text-2xl">{title}</h2>
        <div className="mt-3 space-y-4 text-base leading-relaxed text-slate-600">{children}</div>
      </div>
    </section>
  );
}

export default function GettingStartedPage() {
  return (
    <>
      <Seo title="Memulai" description={DESCRIPTION} path="/getting-started" />
      <main className="min-h-screen bg-[#FAFAF8] text-slate-900">
        <header className="border-b border-slate-100 bg-white/70">
          <nav className="mx-auto flex h-16 max-w-3xl items-center justify-between px-6 md:px-12">
            <Link href="/" className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-700 text-white">
                <ChatCircleDots size={18} weight="fill" />
              </span>
              <span className="font-display text-lg font-extrabold tracking-tight">CSQ</span>
            </Link>
            <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-900">
              <ArrowLeft size={14} weight="bold" /> Kembali ke beranda
            </Link>
          </nav>
        </header>

        <section className="mx-auto max-w-3xl px-6 pb-8 pt-14 md:px-12 md:pt-20">
          <p className="font-mono-data text-xs font-medium uppercase tracking-[0.2em] text-green-700">Memulai</p>
          <h1 className="mt-4 font-display text-3xl font-extrabold tracking-tight md:text-4xl lg:text-5xl">
            Pasang CSQ di server Anda sendiri.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-slate-600 md:text-lg">
            Langkah-langkah di bawah ini sama dengan README proyek: dari VPS
            kosong sampai agent WhatsApp aktif dan sehat.
          </p>
        </section>

        <div className="mx-auto max-w-3xl px-6 pb-24 md:px-12">
          <div className="divide-y divide-slate-100 border-t border-slate-100">
            <Section title="Prasyarat">
              <p>
                Siapkan VPS Ubuntu baru dengan minimal 4 vCPU, RAM 4 GB, dan SSD
                20 GB, plus akses root. Docker dan UFW dikonfigurasi otomatis
                oleh skrip setup bila belum ada.
              </p>
            </Section>

            <Section n="01" title="Kloning">
              <p>Kloning repositori CSQ ke VPS.</p>
              <CodeBlock>{"git clone <your-repo-url> /opt/csq && cd /opt/csq"}</CodeBlock>
            </Section>

            <Section n="02" title="Install">
              <p>
                Jangan build di VPS 4 GB karena build produksi Next.js bisa
                kehabisan memori. Bangun kedua image di mesin yang lebih besar
                atau di CI, lalu dorong ke registry.
              </p>
              <CodeBlock>{`# From the repo root (on your build machine):
docker build -f docker/Dockerfile -t ghcr.io/yourorg/csq-app:latest .
docker build -f docker/nginx/Dockerfile -t ghcr.io/yourorg/csq-nginx:latest docker/nginx/
docker push ghcr.io/yourorg/csq-app:latest
docker push ghcr.io/yourorg/csq-nginx:latest`}</CodeBlock>
            </Section>

            <Section n="03" title="Environment">
              <p>Buat berkas environment produksi dari contoh yang tersedia.</p>
              <CodeBlock>cp apps/dashboard/.env.production.example .env.production</CodeBlock>
              <p>Lalu isi nilai berikut:</p>
              <ul className="list-disc space-y-1 pl-5 text-sm md:text-base">
                <li><span className="font-mono-data text-[13px]">POSTGRES_PASSWORD</span>: kata sandi kuat, perbarui juga di <span className="font-mono-data text-[13px]">DATABASE_URL</span> dan <span className="font-mono-data text-[13px]">DATABASE_URL_UNPOOLED</span>.</li>
                <li><span className="font-mono-data text-[13px]">NEXTAUTH_URL</span>: domain Anda, contoh <span className="font-mono-data text-[13px]">https://umkm.example.com</span>.</li>
                <li><span className="font-mono-data text-[13px]">NEXTAUTH_SECRET</span>: buat dengan <span className="font-mono-data text-[13px]">openssl rand -base64 32</span>.</li>
                <li><span className="font-mono-data text-[13px]">CERT_DOMAIN</span>: domain yang sama, contoh <span className="font-mono-data text-[13px]">umkm.example.com</span>.</li>
                <li><span className="font-mono-data text-[13px]">CSQ_APP_IMAGE</span> dan <span className="font-mono-data text-[13px]">CSQ_NGINX_IMAGE</span>: nama image registry yang Anda dorong di langkah 02.</li>
                <li><span className="font-mono-data text-[13px]">LLM_API_KEY</span>, <span className="font-mono-data text-[13px]">LLM_BASE_URL</span>, <span className="font-mono-data text-[13px]">LLM_CHAT_MODEL</span>: penyedia LLM apa pun yang kompatibel dengan OpenAI, untuk loop agent, skenario, dan embeddings.</li>
                <li><span className="font-mono-data text-[13px]">WHATSAPP_APP_SECRET</span>: App Secret dari aplikasi Meta Anda, untuk validasi HMAC webhook.</li>
                <li><span className="font-mono-data text-[13px]">GOOGLE_CLIENT_ID</span>, <span className="font-mono-data text-[13px]">GOOGLE_CLIENT_SECRET</span>, <span className="font-mono-data text-[13px]">GOOGLE_REDIRECT_URI</span>: untuk Google Sheets, opsional.</li>
              </ul>
              <p className="text-sm">
                Kredensial WhatsApp Cloud API lainnya seperti token dan phone
                number ID dimasukkan per toko lewat dashboard, bukan lewat env.
              </p>
            </Section>

            <Section n="04" title="Database">
              <p>Pilih satu mode. Keduanya butuh pgvector.</p>
              <p>
                <strong className="font-semibold text-slate-900">Mode A, self-host (bawaan).</strong>{" "}
                Pertahankan <span className="font-mono-data text-[13px]">POSTGRES_*</span> dan
                service <span className="font-mono-data text-[13px]">postgres</span> di compose;
                <span className="font-mono-data text-[13px]"> DATABASE_URL</span> menunjuk
                <span className="font-mono-data text-[13px]"> postgres:5432</span> di jaringan
                compose.
              </p>
              <p>
                <strong className="font-semibold text-slate-900">Mode B, Postgres kelolaan</strong>{" "}
                (Neon atau penyedia lain dengan pgvector). Isi
                <span className="font-mono-data text-[13px]"> DATABASE_URL</span> (pooled) dan
                <span className="font-mono-data text-[13px]"> DATABASE_URL_UNPOOLED</span> (direct,
                untuk <span className="font-mono-data text-[13px]">prisma migrate deploy</span>).
                Service <span className="font-mono-data text-[13px]">postgres</span> tidak dipakai
                dan stack dijalankan dengan:
              </p>
              <CodeBlock>docker compose up app nginx certbot</CodeBlock>
              <p className="text-sm">
                Jangan menjalankan service postgres lokal terhadap database yang sama.
              </p>
            </Section>

            <Section n="05" title="Jalankan">
              <p>
                Sertifikat TLS harus sudah ada sebelum nginx mulai. Jalankan
                init-certbot lebih dulu (nginx tidak perlu berjalan), lalu
                jalankan skrip setup.
              </p>
              <CodeBlock>{"CERT_DOMAIN=umkm.example.com EMAIL=you@example.com ./docker/certbot/init-certbot.sh"}</CodeBlock>
              <CodeBlock>bash docker/setup-vps.sh</CodeBlock>
              <p>
                Skrip setup idempoten: memperbarui paket apt, memasang Docker
                bila belum ada, mengatur UFW (SSH, HTTP, HTTPS), menarik image
                dari registry, lalu menjalankan app, postgres, nginx, dan
                certbot. Perpanjangan sertifikat berjalan otomatis tiap 12 jam.
              </p>
            </Section>

            <Section n="06" title="Deploy VPS">
              <p>Setelah stack berjalan, pastikan deploy sehat.</p>
              <CodeBlock>curl -sf https://umkm.example.com/api/health</CodeBlock>
              <p>
                Respons 200 OK berarti aplikasi hidup dan database terjangkau.
              </p>
              <p>
                Instalasi bersih tidak menyertakan tenant demo: owner
                mendaftarkan toko sendiri di <span className="font-mono-data text-[13px]">/register</span>.
                Untuk pratinjau dengan tenant demo Toko Kopi Nusantara:
              </p>
              <CodeBlock>{`cd docker
docker compose --env-file ../.env.production exec -T app npx prisma db seed --schema packages/core/prisma/schema.prisma`}</CodeBlock>
            </Section>
          </div>
        </div>
      </main>
    </>
  );
}
