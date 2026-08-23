// CSQ marketing landing page, public front door at /.
//
// Direction across the loaded taste skills (design-taste-frontend, v1,
// high-end-visual-design, gpt-taste, imagegen-frontend-web,
// image-to-code, stitch-design-taste, brandkit): emerald solid hero,
// gapless bento, one dark scrub-reveal principle. Copy is conversational
// Indonesian with common words (no stiff formalism). Motion is optimized:
// single IntersectionObserver reveals; native CSS animation-timeline
// for the principle scrub; reduced-motion safe; no window.scroll listeners.
import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Plus, Minus, ArrowRight } from "@phosphor-icons/react";
import { Seo, SITE_NAME, SITE_TAGLINE, DEFAULT_DESCRIPTION } from "@/components/seo";
import { Reveal } from "@/components/landing/reveal";

const STEPS = [
  { n: "01", title: "Sambungin data", body: "Masukin Excel atau CSV, sambungkan Google Sheets, atau ketik manual. Agent langsung baca stok, produk, harga, dan aturan dari data yang sudah ada." },
  { n: "02", title: "Atur izin dan ajarin", body: "Pilih apa yang boleh dibaca dan diubah per tool. Tambah FAQ dan aturan. Aksi sensitif butuh persetujuan Anda. Default-nya: baca doang." },
  { n: "03", title: "Deploy ke WhatsApp", body: "Pilih Cloud API resmi atau nomor WA sendiri. Agent bantu pelanggan, sementara Anda pantau dan ambil alih dari inbox kapan saja." },
];

const FEATURES = [
  { cell: "a" as const, title: "Inbox bersama: tim dan AI satu layar", body: "Owner dan staff kerja bareng agent di satu inbox. Tag, tugasin, dan ambil alih dari AI. Agent diem sebentar, balik lagi kalau udah dilepas.", live: true },
  { cell: "b" as const, title: "Baca data yang sudah ada", body: "Excel, CSV, Google Sheets, ketik manual, dan dokumen disatukan lewat Business Context Layer. Agent bacanya sepertti staf Anda.", sources: ["Excel / CSV", "Google Sheets", "Input manual", "PDF"] },
  { cell: "c" as const, title: "Izin per-aksi", body: "Baca default. Nulis cuma kalau dapat izin per tool.", perms: ["Baca default", "Tulis per tool", "Approval owner"] },
  { cell: "d" as const, title: "Audit penuh", body: "Tiap aksi tercatat bareng status persetujuannya.", log: "09:02  permit  product.update  DENIED" },
];

const PRINCIPLE = ["Baca", "default.", "Tulis", "dengan", "izin.", "Bertindak", "sesuai", "aturan."];
const PRINCIPLE_POINTS = ["Izin per-tool", "Approval owner", "Audit sebelum dan sesudah", "Ambil alih kapan saja"];

const FAQS: { q: string; a: string }[] = [
  { q: "Apakah saya butuh coding?", a: "Nggak. CSQ dibikin buat owner UMKM. Sambungin data, ajarin aturan, atur izin dari dashboard, tanpa kode." },
  { q: "Apakah datanya aman?", a: "CSQ self-host: pasang di server sendiri pakai Docker Compose. Data usaha dan pelanggan tetap di tangan Anda, terpisah per tenant." },
  { q: "Bisa pakai nomor WhatsApp sendiri?", a: "Bisa. Pilih Cloud API resmi Meta atau Baileys pakai nomor sendiri lewat QR. Anda milih pas onboarding, dua-duanya ada." },
  { q: "Kalau AI salah jawab atau ngapa-ngapa di luar batas?", a: "Agent baca default dan nulis cuma kalau dapat izin per tool. Aksi sensitif butuh persetujuan owner. Tiap aksi tercatat buat audit, dan Anda bisa ambil alih kapan saja." },
  { q: "Berapa harganya?", a: "CSQ open buat dihosting sendiri. Anda cuma bayar server, VPS kecil udah cukup, plus biaya WhatsApp Cloud API sesuai pemakaian." },
];

const HEADLINE = [
  { t: "Layani", a: false },
  { t: "pelanggan", a: false },
  { t: "di", a: false },
  { t: "WhatsApp", a: false },
  { t: "dengan", a: false },
  { t: "agen", a: false },
  { t: "AI", a: false },
  { t: "yang", a: false },
  { t: "mengenal", a: true },
  { t: "data", a: true },
  { t: "bisnis", a: true },
  { t: "Anda.", a: true },
];

const jsonLd = [
  { "@context": "https://schema.org", "@type": "Organization", name: SITE_NAME, description: DEFAULT_DESCRIPTION, logo: "/icon.svg" },
  { "@context": "https://schema.org", "@type": "WebSite", name: SITE_NAME, inLanguage: "id-ID", url: "/" },
  { "@context": "https://schema.org", "@type": "SoftwareApplication", name: SITE_NAME, applicationCategory: "BusinessApplication", operatingSystem: "Web", description: DEFAULT_DESCRIPTION, offers: { "@type": "Offer", price: "0", priceCurrency: "IDR" } },
  { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: FAQS.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) },
];

export default function Home() {
  return (
    <>
      <Seo description={DEFAULT_DESCRIPTION} path="/" jsonLd={jsonLd} />
      <main className="w-full max-w-full overflow-x-hidden bg-[#FAFAF8] text-[#141A17]">
        <Navbar />
        <Hero />
        <TrustBar />
        <HowItWorks />
        <Bento />
        <Principle />
        <Faq />
        <Cta />
        <Footer />
      </main>
    </>
  );
}

/* ------------------------------- Navbar ------------------------------- */

function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 8);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className={"sticky top-0 z-40 transition-shadow " + (scrolled ? "shadow-[0_10px_40px_-24px_rgba(20,26,23,0.3)]" : "")}>
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-[0.6rem] bg-green-700 text-white">
            <span className="font-display text-sm font-extrabold">C</span>
          </span>
          <span className="font-display text-lg font-extrabold tracking-tight">CSQ</span>
        </Link>
        <div className="hidden items-center gap-8 text-sm text-[#141A17]/70 md:flex">
          <a href="#cara-kerja" className="hover:text-[#141A17]">Cara Kerja</a>
          <a href="#fitur" className="hover:text-[#141A17]">Fitur</a>
          <a href="#prinsip" className="hover:text-[#141A17]">Keamanan</a>
          <a href="#faq" className="hover:text-[#141A17]">FAQ</a>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/login" className="hidden text-sm font-medium text-[#141A17]/70 hover:text-[#141A17] sm:block">Masuk</Link>
          <Link href="/register" className="inline-flex items-center gap-1.5 rounded-full bg-green-700 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-800">
            Coba gratis <ArrowRight size={13} weight="bold" />
          </Link>
        </div>
      </nav>
    </header>
  );
}

/* -------------------------------- Hero -------------------------------- */
/* Emerald solid color-field hero. Centered cinematic statement,
   per-word kinetic reveal, one primary + one ghost CTA. */

function Hero() {
  return (
    <section className="relative overflow-hidden bg-green-700 text-[#F4FBF7]">
      <div
        className="pointer-events-none absolute inset-0"
        style={{ backgroundImage: "radial-gradient(60% 55% at 50% 0%, rgba(220,252,231,0.22), transparent 70%)" }}
      />
      <div className="relative mx-auto max-w-5xl px-5 py-32 text-center sm:px-8 md:py-48">
        <h1
          className="font-display font-extrabold leading-[1.06] tracking-tight"
          style={{ fontSize: "clamp(2.5rem, 5.2vw, 4.5rem)" }}
        >
          {HEADLINE.map((w, i) => (
            <span
              key={i}
              className={"rise-inline inline-block " + (w.a ? "text-[#F4FBF7]" : "text-white/80")}
              style={{ animationDelay: `${i * 55}ms` }}
            >
              {w.t}&nbsp;
            </span>
          ))}
        </h1>
        <p className="rise-in mx-auto mt-7 max-w-2xl text-base leading-relaxed text-white/75 sm:text-lg" style={{ animationDelay: "440ms" }}>
          CSQ baca data usaha Anda, dari stok sampai kebijakan.
          Membaca default, menulis hanya kalau Anda izinkan.
        </p>
        <div className="rise-in mt-9 flex flex-wrap items-center justify-center gap-3" style={{ animationDelay: "540ms" }}>
          <Link
            href="/register"
            className="group group-cta inline-flex items-center gap-2.5 rounded-full bg-white px-6 py-3.5 text-sm font-semibold text-green-800 shadow-[0_14px_34px_-14px_rgba(0,0,0,0.25)] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#F4FBF7] active:scale-[0.98]"
          >
            Coba gratis
            <span className="cta-arrow flex h-7 w-7 items-center justify-center rounded-full bg-green-800/10">
              <ArrowRight size={14} weight="bold" />
            </span>
          </Link>
          <a
            href="#cara-kerja"
            className="inline-flex items-center gap-2 rounded-full border border-white/30 px-6 py-3.5 text-sm font-semibold text-white transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-white/10 active:scale-[0.98]"
          >
            Pelajari cara kerja
          </a>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------ TrustBar ------------------------------ */

function TrustBar() {
  return (
    <section className="border-y border-[#141A17]/[0.07] bg-white/60 py-7">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-5 gap-y-2 px-5 text-center sm:px-8">
        <span className="font-mono-data text-xs font-medium uppercase tracking-[0.14em] text-[#141A17]/40">Terhubung ke</span>
        {["WhatsApp", "Google Sheets", "Excel / CSV", "PDF", "Input manual"].map((c) => (
          <span key={c} className="text-sm font-medium text-[#141A17]/55">{c}</span>
        ))}
      </div>
    </section>
  );
}

/* ---------------------------- HowItWorks ---------------------------- */

function HowItWorks() {
  return (
    <section id="cara-kerja" className="mx-auto max-w-6xl px-5 py-32 sm:px-8 md:py-48">
      <Reveal>
        <p className="font-mono-data text-[11px] font-medium uppercase tracking-[0.18em] text-green-700">Cara kerja</p>
        <h2 className="mt-4 max-w-3xl font-display text-3xl font-extrabold tracking-tight sm:text-4xl md:text-5xl">
          Dari data ke AI yang bantu layani pelanggan, tiga langkah.
        </h2>
      </Reveal>

      <div className="mt-16 divide-y divide-[#141A17]/[0.08] border-t border-[#141A17]/[0.08]">
        {STEPS.map((s, i) => (
          <Reveal key={s.n} delay={i * 90}>
            <div className="grid gap-5 py-10 md:grid-cols-[auto_1fr] md:gap-12 md:py-12">
              <p className="font-display text-4xl font-extrabold tracking-tight text-green-700/25">{s.n}</p>
              <div className="max-w-xl">
                <h3 className="font-display text-xl font-bold tracking-tight sm:text-2xl">{s.title}</h3>
                <p className="mt-3 text-base leading-relaxed text-[#141A17]/65 sm:text-lg">{s.body}</p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------ Bento ------------------------------ */
/* Gapless bento, grid-flow-dense, 4 interlocking cells. Rows
   auto-size to content (no fixed height -> no vertical overflow), min-h for
   visual weight. Audit log wraps (no horizontal scroll). Hover scale. */

function Bento() {
  const f = FEATURES;
  return (
    <section id="fitur" className="bg-[#141A17]/[0.025] py-32 md:py-48">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal>
          <p className="font-mono-data text-[11px] font-medium uppercase tracking-[0.18em] text-green-700">Fitur</p>
          <h2 className="mt-4 max-w-3xl font-display text-3xl font-extrabold tracking-tight sm:text-4xl md:text-5xl">
            Apa yang agent butuh buat melayani, dan apa yang Anda butuh buat ngontrol.
          </h2>
        </Reveal>

        <div className="mt-14 grid grid-cols-1 gap-4 lg:grid-cols-4 lg:grid-flow-dense">
          {/* A: big emerald cell, live indicator (real semantic state) */}
          <Reveal className="lg:col-span-2 lg:row-span-2">
            <div className="group flex min-h-[13rem] flex-col overflow-hidden rounded-[2rem] bg-green-700 p-8 text-[#F4FBF7] ring-1 ring-white/10 transition-transform duration-700 ease-out group-hover:scale-[1.02]">
              <div className="flex items-center gap-2 font-mono-data text-[11px] text-[#F4FBF7]/70">
                <span className="h-1.5 w-1.5 rounded-full bg-[#9DEACE]" /> AI menangani
              </div>
              <h3 className="mt-6 max-w-md font-display text-2xl font-bold tracking-tight sm:text-3xl">{f[0].title}</h3>
              <p className="mt-3 max-w-md text-base leading-relaxed text-white/75">{f[0].body}</p>
              <p className="mt-auto font-mono-data text-xs text-white/55">Ambil alih kapan saja.</p>
            </div>
          </Reveal>

          {/* C: tinted, permission list */}
          <Reveal delay={70}>
            <div className="group flex min-h-[13rem] flex-col overflow-hidden rounded-[2rem] bg-green-700/[0.07] p-1.5 ring-1 ring-green-700/15 transition-transform duration-700 ease-out group-hover:scale-[1.02]">
              <div className="flex h-full flex-col rounded-[1.65rem] bg-green-50/50 p-7">
                <h3 className="font-display text-lg font-bold tracking-tight">{f[2].title}</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-[#141A17]/70">{f[2].body}</p>
                <ul className="mt-auto space-y-2 pt-4 text-xs text-[#141A17]/65">
                  {f[2].perms?.map((p) => (
                    <li key={p} className="flex items-center gap-2">
                      <Check size={12} weight="bold" className="text-green-700" /> {p}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Reveal>

          {/* D: white, audit snippet (wraps, no horizontal scroll) */}
          <Reveal delay={140}>
            <div className="group flex min-h-[13rem] flex-col overflow-hidden rounded-[2rem] bg-[#141A17]/[0.04] p-1.5 ring-1 ring-[#141A17]/[0.06] transition-transform duration-700 ease-out group-hover:scale-[1.02]">
              <div className="flex h-full flex-col rounded-[1.65rem] bg-white p-7 shadow-[inset_0_1px_1px_rgba(255,255,255,0.85),0_24px_70px_-34px_rgba(20,26,23,0.22)]">
                <h3 className="font-display text-lg font-bold tracking-tight">{f[3].title}</h3>
                <p className="mt-2.5 text-sm leading-relaxed text-[#141A17]/70">{f[3].body}</p>
                <pre className="mt-auto overflow-hidden whitespace-pre-wrap break-words rounded-lg bg-[#0B1F14] px-3 py-2 font-mono-data text-[11px] leading-relaxed text-[#9DEACE]">
                  {f[3].log}
                </pre>
              </div>
            </div>
          </Reveal>

          {/* B: wide, sources */}
          <Reveal className="lg:col-span-2" delay={70}>
            <div className="group flex min-h-[13rem] flex-col overflow-hidden rounded-[2rem] bg-white p-7 ring-1 ring-[#141A17]/[0.06] transition-transform duration-700 ease-out group-hover:scale-[1.02]">
              <h3 className="font-display text-lg font-bold tracking-tight">{f[1].title}</h3>
              <p className="mt-2.5 max-w-md text-sm leading-relaxed text-[#141A17]/70">{f[1].body}</p>
              <div className="mt-5 flex flex-wrap gap-2">
                {f[1].sources?.map((s) => (
                  <span key={s} className="rounded-full bg-[#141A17]/[0.05] px-3 py-1 text-xs font-medium text-[#141A17]/70">{s}</span>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ----------------------------- Principle ----------------------------- */
/* One dark color-block. Native CSS scroll-driven scrub on the
   headline words (zero JS, GPU composited) where supported. */

function Principle() {
  return (
    <section id="prinsip" className="bg-[#0B1F14] py-32 text-[#EDEFEA] md:py-48">
      <div className="mx-auto max-w-4xl px-5 text-center sm:px-8">
        <h2 className="font-display font-extrabold leading-[1.12] tracking-tight" style={{ fontSize: "clamp(2.25rem, 6vw, 5rem)" }}>
          {PRINCIPLE.map((w, i) => (
            <span key={i} className="scrub-word inline-block">
              {w}&nbsp;
            </span>
          ))}
        </h2>
        <Reveal>
          <p className="mx-auto mt-9 max-w-2xl text-base leading-relaxed text-[#EDEFEA]/70 sm:text-lg">
            Agent cuma baca dan jawab. Tiap aksi yang ubah data butuh izin
            terpisah, sebagian butuh persetujuan Anda. Anda yang pegang
            kendali, agent yang kerja.
          </p>
          <div className="mt-11 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-[#EDEFEA]/85">
            {PRINCIPLE_POINTS.map((p) => (
              <span key={p} className="inline-flex items-center gap-2">
                <Check size={15} weight="bold" className="text-[#9DEACE]" /> {p}
              </span>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* -------------------------------- FAQ -------------------------------- */

function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-3xl px-5 py-32 sm:px-8 md:py-48">
      <Reveal>
        <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl md:text-5xl">Pertanyaan yang sering muncul.</h2>
      </Reveal>
      <div className="mt-12 divide-y divide-[#141A17]/[0.1] border-t border-[#141A17]/[0.1]">
        {FAQS.map((f, i) => (
          <Reveal key={f.q} delay={i * 50}>
            <details className="group py-6">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
                <span className="font-display text-base font-semibold sm:text-lg">{f.q}</span>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[#141A17]/15 text-[#141A17]/60 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-open:rotate-180">
                  <Plus size={15} className="block group-open:hidden" />
                  <Minus size={15} className="hidden group-open:block" />
                </span>
              </summary>
              <p className="mt-3 max-w-2xl text-base leading-relaxed text-[#141A17]/65">{f.a}</p>
            </details>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* -------------------------------- CTA -------------------------------- */

function Cta() {
  return (
    <section className="mx-auto max-w-6xl px-5 pb-32 sm:px-8 md:pb-48">
      <Reveal>
        <div className="rounded-[2.5rem] bg-green-700/[0.07] p-2 ring-1 ring-green-700/15">
          <div className="rounded-[2rem] bg-[#F4FBF7] px-6 py-16 text-center sm:px-12">
            <h2 className="font-display text-3xl font-extrabold tracking-tight text-green-900 sm:text-4xl md:text-5xl">
              Siap bikin AI kerja buat usaha Anda?
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base text-green-900/70">
              Sambungin data, ajarin aturan, atur izin, lalu deploy agent ke WhatsApp sebentar.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link
                href="/register"
                className="group group-cta inline-flex items-center gap-2.5 rounded-full bg-green-700 px-6 py-3.5 text-sm font-semibold text-white shadow-[0_14px_34px_-14px_rgba(21,128,61,0.55)] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-green-800 active:scale-[0.98]"
              >
                Coba gratis
                <span className="cta-arrow flex h-7 w-7 items-center justify-center rounded-full bg-white/15">
                  <ArrowRight size={14} weight="bold" />
                </span>
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-full border border-green-900/15 px-6 py-3.5 text-sm font-semibold text-green-900 transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-green-900/[0.04] active:scale-[0.98]"
              >
                Masuk dashboard
              </Link>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}

/* ------------------------------- Footer ------------------------------- */

function Footer() {
  return (
    <footer className="border-t border-[#141A17]/[0.08] bg-white">
      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-1">
            <Link href="/" className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-[0.6rem] bg-green-700 text-white">
                <span className="font-display text-sm font-extrabold">C</span>
              </span>
              <span className="font-display text-lg font-extrabold tracking-tight">CSQ</span>
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-[#141A17]/55">
              {SITE_TAGLINE}. Self-host, multi-tenant, data tetap milik Anda.
            </p>
          </div>
          <FooterCol title="Produk" links={[{ label: "Cara Kerja", href: "#cara-kerja" }, { label: "Fitur", href: "#fitur" }, { label: "Keamanan", href: "#prinsip" }, { label: "FAQ", href: "#faq" }]} />
          <FooterCol title="Mulai" links={[{ label: "Daftar", href: "/register" }, { label: "Masuk", href: "/login" }, { label: "Dashboard", href: "/dashboard" }]} />
          <div>
            <p className="font-mono-data text-xs font-bold uppercase tracking-wider text-[#141A17]">Prinsip</p>
            <p className="mt-4 text-sm leading-relaxed text-[#141A17]/55">
              Baca secara default.<br />Tulis dengan izin.<br />Bertindak sesuai aturan.
            </p>
          </div>
        </div>
        <div className="mt-10 flex flex-col items-start justify-between gap-3 border-t border-[#141A17]/[0.08] pt-6 text-xs text-[#141A17]/45 sm:flex-row sm:items-center">
          <p>&copy; {new Date().getFullYear()} {SITE_NAME}. Dibuat untuk UMKM Indonesia.</p>
          <p className="font-mono-data uppercase tracking-wider">Self-hosted</p>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <p className="font-mono-data text-xs font-bold uppercase tracking-wider text-[#141A17]">{title}</p>
      <ul className="mt-4 space-y-2.5 text-sm">
        {links.map((l) => (
          <li key={l.label}>
            <Link href={l.href} className="text-[#141A17]/60 transition-colors hover:text-[#141A17]">{l.label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
