// CSQ marketing landing page, public front door at /.
//
// Recreated from the four docs/demo specs (hero with coded dashboard preview,
// triptych feature cards, cost calculator, parallax CTA) adapted to CSQ's
// real stack and content: Phosphor icons (not Lucide), cn + Tailwind,
// IntersectionObserver reveals (not Framer), native range input (not shadcn
// Slider), CSS scroll-driven parallax (not useScroll). Plus Jakarta with
// italic same-family emphasis (no serif injection). CSQ content: inbox
// dashboard preview, audit/permission, self-host cost estimator.
// Semiformal copy, one accent, zero em-dashes, reduced-motion safe.
import Link from "next/link";
import { Check, Plus, Minus, ArrowRight } from "@phosphor-icons/react";
import { Seo, SITE_NAME, SITE_TAGLINE, DEFAULT_DESCRIPTION } from "@/components/seo";
import { Reveal } from "@/components/landing/reveal";
import { DashboardPreview } from "@/components/landing/dashboard-preview";
import { Calculator } from "@/components/landing/calculator";
import { Cta } from "@/components/landing/cta";

const STEPS = [
  { n: "01", title: "Sambungkan data", body: "Masukkan Excel atau CSV, sambungkan Google Sheets, atau mengetik manual. Agent langsung membaca stok, produk, harga, dan aturan dari data yang sudah ada." },
  { n: "02", title: "Atur izin dan ajarkan", body: "Pilih apa yang boleh dibaca dan diubah per tool. Tambahkan FAQ dan aturan. Aksi sensitif butuh persetujuan Anda. Default-nya: hanya membaca." },
  { n: "03", title: "Deploy ke WhatsApp", body: "Pilih Cloud API resmi atau nomor WhatsApp sendiri. Agent membantu pelanggan, sementara Anda memantau dan mengambil alih dari inbox kapan saja." },
];

const TRIPTYCH = [
  {
    title: "Inbox bersama",
    body: "Owner dan staf bekerja sama dengan agent di satu inbox. Tag, menugaskan, dan ambil alih dari AI.",
    visual: "inbox" as const,
  },
  {
    title: "Agent CS di WhatsApp",
    body: "Membaca stok, harga, dan kebijakan dari data usaha Anda. Menjawab pelanggan 24/7 di dalam jendela balas WhatsApp.",
    visual: "agent" as const,
    anchor: true,
  },
  {
    title: "Izin per-aksi",
    body: "Membaca secara default. Menulis hanya dengan izin per tool, aksi sensitif butuh persetujuan owner.",
    visual: "perms" as const,
  },
];

const FAQS: { q: string; a: string }[] = [
  { q: "Apakah saya butuh coding?", a: "Tidak. CSQ dibuat untuk owner UMKM. Sambungkan data, ajarkan aturan, atur izin dari dashboard, tanpa kode." },
  { q: "Apakah datanya aman?", a: "CSQ self-host: dipasang di server sendiri dengan Docker Compose. Data usaha dan pelanggan tetap di tangan Anda, terpisah per tenant." },
  { q: "Bisa pakai nomor WhatsApp sendiri?", a: "Bisa. Pilih Cloud API resmi Meta atau Baileys menggunakan nomor sendiri lewat QR. Anda memilih saat onboarding, keduanya tersedia." },
  { q: "Kalau AI salah jawab atau melakukan hal di luar batas?", a: "Agent membaca secara default dan menulis hanya dengan izin per tool. Aksi sensitif butuh persetujuan owner. Tiap aksi tercatat untuk audit, dan Anda bisa mengambil alih kapan saja." },
  { q: "Berapa harganya?", a: "CSQ bersifat open untuk dihosting sendiri. Anda hanya perlu membayar server, VPS kecil sudah cukup, plus biaya WhatsApp Cloud API sesuai penggunaan." },
];

const PRINCIPLE = ["Baca", "default.", "Tulis", "dengan", "izin.", "Bertindak", "sesuai", "aturan."];
const PRINCIPLE_POINTS = ["Izin per-tool", "Approval owner", "Audit sebelum dan sesudah", "Ambil alih kapan saja"];

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
      <main className="w-full max-w-full overflow-x-hidden bg-[#FAFAF8] text-slate-900">
        <Hero />
        <DashboardSection />
        <Channels />
        <Triptych />
        <HowItWorks />
        <Calculator />
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
  return (
    <header className="sticky top-0 z-40 bg-transparent">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6 md:px-12 lg:px-20">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-700 text-white font-display text-sm font-extrabold">C</span>
          <span className="font-display text-lg font-extrabold tracking-tight">CSQ</span>
        </Link>
        <div className="hidden items-center gap-8 text-sm text-slate-500 md:flex">
          <a href="#fitur" className="hover:text-slate-900">Fitur</a>
          <a href="#cara-kerja" className="hover:text-slate-900">Cara Kerja</a>
          <a href="#biaya" className="hover:text-slate-900">Biaya</a>
          <a href="#faq" className="hover:text-slate-900">FAQ</a>
        </div>
        <Link href="/register" className="inline-flex items-center gap-1.5 rounded-full bg-slate-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800">
          Coba gratis <ArrowRight size={14} weight="bold" />
        </Link>
      </nav>
    </header>
  );
}

/* -------------------------------- Hero -------------------------------- */
/* Light hero: badge, headline with italic emphasis, subheadline,
   primary + ghost CTA, coded dashboard preview (frosted glass). */

function Hero() {
  return (
    <section className="relative min-h-[100dvh] overflow-hidden flex flex-col">
      {/* Background video (per hero spec). Atmospheric, muted autoplay loop. */}
      <video
        autoPlay
        loop
        muted
        playsInline
        preload="auto"
        className="absolute inset-0 z-0 h-full w-full object-cover"
        aria-hidden
      >
        <source
          src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260319_015952_e1deeb12-8fb7-4071-a42a-60779fc64ab6.mp4"
          type="video/mp4"
        />
      </video>
      {/* Legibility wash for the content area only - starts below the navbar
          so the video shows through the transparent header (0-64px). */}
      <div
        className="absolute inset-x-0 bottom-0 top-16 z-10"
        style={{ background: "linear-gradient(to bottom, rgba(250,250,248,0.72), rgba(250,250,248,0.6) 60%, rgba(250,250,248,0.85))" }}
      />

      {/* Navbar + hero share one 100dvh flex column: navbar on top,
          content fills the remaining space below it (auto space, no padding guesswork). */}
      <div className="relative z-40">
        <Navbar />
      </div>

      <div className="relative z-20 flex flex-1 flex-col items-center justify-center px-6 text-center md:px-12">
        <div className="flex flex-col items-center">
          <span className="animate-fade-rise inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/80 px-4 py-1.5 text-sm text-slate-600 backdrop-blur">
            <Check size={14} weight="bold" className="text-green-700" /> Self-host, data milik Anda
          </span>

          <h1 className="animate-fade-rise-delay mt-6 max-w-3xl font-display text-5xl font-extrabold leading-[0.95] tracking-tight text-slate-900 md:text-6xl lg:text-[5rem]">
            Layani pelanggan di WhatsApp dengan agen AI yang{" "}
            <em className="not-italic font-display italic text-green-700">mengenal data bisnis Anda</em>.
          </h1>

          <p className="animate-fade-rise-delay-2 mt-5 max-w-[650px] text-base leading-relaxed text-slate-600 md:text-lg">
            CSQ membaca stok, harga, dan kebijakan dari data yang sudah Anda
            punya. Membaca secara default, menulis hanya jika Anda izinkan.
          </p>

          <div className="mt-7 flex items-center justify-center gap-3">
            <Link href="/register" className="inline-flex items-center gap-2 rounded-full bg-slate-900 px-6 py-3.5 text-sm font-medium text-white transition-colors hover:bg-slate-800">
              Coba gratis <ArrowRight size={15} weight="bold" />
            </Link>
            <a href="#cara-kerja" className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white/70 px-6 py-3.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 backdrop-blur">
              Pelajari cara kerja
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}

/* Coded dashboard preview on its own section, below the hero, so the hero
   (headline + CTAs) has breathing room and nothing overflows into the
   next section on shorter viewports. */
function DashboardSection() {
  return (
    <section className="bg-[#FAFAF8] pb-20 pt-24 md:pb-28">
      <div className="mx-auto max-w-5xl px-6 md:px-12">
        <div className="animate-fade-rise">
          <DashboardPreview />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------ Channels ------------------------------ */

function Channels() {
  return (
    <section className="border-y border-slate-100 bg-white/60 py-7">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-6 gap-y-2 px-6 text-center">
        <span className="font-mono-data text-xs font-medium uppercase tracking-[0.14em] text-slate-400">Terhubung ke</span>
        {["WhatsApp", "Google Sheets", "Excel / CSV", "PDF", "Input manual"].map((c) => (
          <span key={c} className="text-sm font-medium text-slate-500">{c}</span>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------ Triptych ------------------------------ */
/* Three peer feature cards, light theme, soft green-tinted borders, warm
   shadows. Centre card is the product anchor. CSS visuals (no canvas). */

function Triptych() {
  return (
    <section id="fitur" className="bg-[#F4FBF7] py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-6 md:px-12">
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3 md:items-stretch">
          {TRIPTYCH.map((card, i) => (
            <Reveal key={card.title} delay={i === 1 ? 0 : i === 0 ? 120 : 240}>
              <article
                className={
                  "relative flex flex-col overflow-hidden rounded-2xl border bg-white p-7 shadow-[0_25px_60px_-24px_rgba(20,26,23,0.12)] " +
                  (card.anchor
                    ? "border-green-200 ring-2 ring-green-700/20 shadow-[0_30px_70px_-24px_rgba(21,128,61,0.25)]"
                    : "border-slate-200") +
                  (i === TRIPTYCH.length - 1 ? " md:mt-6 md:h-[calc(100%-1.5rem)]" : " h-full")
                }
              >
                <TriptychVisual kind={card.visual} />
                <h3 className="mt-5 font-display text-lg font-bold tracking-tight text-slate-900">{card.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">{card.body}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function TriptychVisual({ kind }: { kind: "inbox" | "agent" | "perms" }) {
  // Consistent min-height across all three so the titles sit at the
  // same y (the middle agent visual is smaller and centers in this area).
  const wrap = "flex min-h-[7.5rem] items-center justify-center rounded-xl bg-slate-50 p-4";
  if (kind === "inbox") {
    return (
      <div className={wrap + " flex-col items-stretch justify-center gap-2"}>
        <div className="ml-auto w-2/3 rounded-2xl rounded-[1rem_1rem_1rem_0.25rem] bg-slate-200 px-3 py-2 text-[10px] text-slate-700">Ada kopi arabika?</div>
        <div className="mr-auto w-2/3 rounded-2xl rounded-[1rem_1rem_0.25rem_1rem] bg-green-100 px-3 py-2 text-[10px] text-green-800">Masih, stok 12.</div>
        <div className="ml-auto w-1/2 rounded-2xl rounded-[1rem_1rem_1rem_0.25rem] bg-amber-50 px-3 py-2 text-[10px] text-amber-700">Perlu izin</div>
      </div>
    );
  }
  if (kind === "agent") {
    return (
      <div className={wrap}>
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-green-600 text-white font-display text-sm font-extrabold">C</span>
          <div>
            <p className="text-xs font-semibold text-slate-900">CSQ Agent</p>
            <p className="text-[10px] text-green-600">AI menangani 24/7</p>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className={wrap + " flex-col justify-center gap-2.5"}>
      {[
        { l: "Baca produk & stok", s: "Boleh", c: "bg-green-100 text-green-700" },
        { l: "Membuat pesanan", s: "Boleh", c: "bg-green-100 text-green-700" },
        { l: "Mengubah harga", s: "Perlu izin", c: "bg-amber-100 text-amber-700" },
      ].map((r) => (
        <div key={r.l} className="flex items-center justify-between gap-3">
          <span className="text-[11px] text-slate-600">{r.l}</span>
          <span className={"rounded-full px-2.5 py-0.5 text-[10px] font-semibold " + r.c}>{r.s}</span>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------- HowItWorks ---------------------------- */

function HowItWorks() {
  return (
    <section id="cara-kerja" className="mx-auto max-w-6xl px-6 py-24 md:px-12 md:py-32">
      <Reveal>
        <p className="font-mono-data text-xs font-medium uppercase tracking-[0.2em] text-green-700">Cara kerja</p>
        <h2 className="mt-4 max-w-3xl font-display text-3xl font-extrabold tracking-tight md:text-4xl lg:text-5xl">
          Dari data ke AI yang membantu melayani pelanggan, tiga langkah.
        </h2>
      </Reveal>
      <div className="mt-14 divide-y divide-slate-100 border-t border-slate-100">
        {STEPS.map((s, i) => (
          <Reveal key={s.n} delay={i * 90}>
            <div className="grid gap-5 py-8 md:grid-cols-[auto_1fr] md:gap-12 md:py-10">
              <p className="font-display text-4xl font-extrabold tracking-tight text-green-700/25">{s.n}</p>
              <div className="max-w-xl">
                <h3 className="font-display text-xl font-bold tracking-tight md:text-2xl">{s.title}</h3>
                <p className="mt-3 text-base leading-relaxed text-slate-600 md:text-lg">{s.body}</p>
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ----------------------------- Principle ----------------------------- */
/* One emerald color-block. Native CSS scrub on the headline words. */

function Principle() {
  return (
    <section id="prinsip" className="bg-green-700 py-24 text-white md:py-32">
      <div className="mx-auto max-w-4xl px-6 text-center md:px-12">
        <h2 className="font-display font-extrabold leading-[1.1] tracking-tight" style={{ fontSize: "clamp(2.25rem, 6vw, 5rem)" }}>
          {PRINCIPLE.map((w, i) => (
            <span key={i} className="scrub-word inline-block">
              {w}&nbsp;
            </span>
          ))}
        </h2>
        <Reveal>
          <p className="mx-auto mt-8 max-w-2xl text-base leading-relaxed text-white/80 md:text-lg">
            Agent hanya membaca dan menjawab. Tiap aksi yang mengubah data
            butuh izin terpisah, sebagian butuh persetujuan Anda. Anda yang
            memegang kendali, agent yang bekerja.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-white/90">
            {PRINCIPLE_POINTS.map((p) => (
              <span key={p} className="inline-flex items-center gap-2">
                <Check size={15} weight="bold" className="text-white" /> {p}
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
    <section id="faq" className="mx-auto max-w-3xl px-6 py-24 md:px-12 md:py-32">
      <Reveal>
        <h2 className="font-display text-3xl font-extrabold tracking-tight md:text-4xl lg:text-5xl">Pertanyaan yang sering muncul.</h2>
      </Reveal>
      <div className="mt-10 divide-y divide-slate-100 border-t border-slate-100">
        {FAQS.map((f, i) => (
          <Reveal key={f.q} delay={i * 50}>
            <details className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
                <span className="font-display text-base font-semibold md:text-lg">{f.q}</span>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] group-open:rotate-180">
                  <Plus size={15} className="block group-open:hidden" />
                  <Minus size={15} className="hidden group-open:block" />
                </span>
              </summary>
              <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-600">{f.a}</p>
            </details>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------- Footer ------------------------------- */

function Footer() {
  return (
    <footer className="border-t border-slate-100 bg-white">
      <div className="mx-auto max-w-6xl px-6 py-14 md:px-12">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-1">
            <Link href="/" className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-700 text-white font-display text-sm font-extrabold">C</span>
              <span className="font-display text-lg font-extrabold tracking-tight">CSQ</span>
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-slate-500">
              {SITE_TAGLINE}. Self-host, multi-tenant, data tetap milik Anda.
            </p>
          </div>
          <FooterCol title="Produk" links={[{ label: "Fitur", href: "#fitur" }, { label: "Cara Kerja", href: "#cara-kerja" }, { label: "Biaya", href: "#biaya" }, { label: "FAQ", href: "#faq" }]} />
          <FooterCol title="Mulai" links={[{ label: "Daftar", href: "/register" }, { label: "Masuk", href: "/login" }, { label: "Dashboard", href: "/dashboard" }]} />
          <div>
            <p className="font-mono-data text-xs font-bold uppercase tracking-wider text-slate-900">Prinsip</p>
            <p className="mt-4 text-sm leading-relaxed text-slate-500">
              Baca secara default.<br />Tulis dengan izin.<br />Bertindak sesuai aturan.
            </p>
          </div>
        </div>
        <div className="mt-10 flex flex-col items-start justify-between gap-3 border-t border-slate-100 pt-6 text-xs text-slate-400 sm:flex-row sm:items-center">
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
      <p className="font-mono-data text-xs font-bold uppercase tracking-wider text-slate-900">{title}</p>
      <ul className="mt-4 space-y-2.5 text-sm">
        {links.map((l) => (
          <li key={l.label}>
            <Link href={l.href} className="text-slate-500 transition-colors hover:text-slate-900">{l.label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
