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
import { Check, ArrowRight, ChatCircleDots } from "@phosphor-icons/react";
import { Seo, SITE_NAME, SITE_TAGLINE, DEFAULT_DESCRIPTION } from "@/components/seo";
import { Reveal } from "@/components/landing/reveal";
import { DashboardPreview } from "@/components/landing/dashboard-preview";
import { Calculator } from "@/components/landing/calculator";
import { FaqCta } from "@/components/landing/faq-cta";

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
        <Channels />
        <Triptych />
        <HowItWorks />
        <Calculator />
        <Principle />
        <FaqCta />
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
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-700 text-white">
            <ChatCircleDots size={18} weight="fill" />
          </span>
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
    <section className="relative h-[820px] overflow-hidden flex flex-col">
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
      {/* Legibility wash covering the full video, including behind the header,
          so the whole hero has a consistent cloudy white cover. */}
      <div
        className="absolute inset-0 z-10"
        style={{ background: "linear-gradient(to bottom, rgba(250,250,248,0.72), rgba(250,250,248,0.6) 60%, rgba(250,250,248,0.85))" }}
      />

      {/* Navbar + hero share one 760px flex column: navbar on top,
          content fills the remaining space below it (auto space, no padding guesswork). */}
      <div className="relative z-40">
        <Navbar />
      </div>

      <div className="relative z-20 flex flex-1 flex-col items-center px-6 pt-8 text-center md:px-12 md:pt-12">
        <div className="flex flex-col items-center">
          <span className="animate-fade-rise inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white/80 px-4 py-1.5 text-sm text-slate-600 backdrop-blur">
            <Check size={14} weight="bold" className="text-green-700" /> Self-host, data milik Anda
          </span>

          <h1 className="animate-fade-rise-delay mt-6 max-w-3xl font-display text-5xl font-extrabold leading-[0.95] tracking-tight text-slate-900 md:text-6xl">
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

        {/* Coded dashboard preview on the hero, on top of the video. Overflows
            toward the bottom and is clipped by overflow-hidden (per spec). */}
        <div className="animate-fade-rise-delay-2 mt-8 w-full max-w-5xl">
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
  const wrap = "flex min-h-[7.5rem] items-center justify-center rounded-xl bg-slate-50 p-4 select-none pointer-events-none";
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
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-green-600 text-white">
            <ChatCircleDots size={20} weight="fill" />
          </span>
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

/* ------------------------------- Footer ------------------------------- */

function Footer() {
  return (
    <footer className="bg-[#fafafa] pt-20 pb-5 md:pt-24">
      <div className="mx-auto max-w-[1100px] w-full px-5">
        <div className="mb-[50px] grid gap-10 md:grid-cols-[2fr_1fr_1fr_2fr] max-[900px]:grid-cols-2 max-[480px]:grid-cols-1">
          {/* Logo */}
          <div>
            <Link href="/" className="mb-[15px] flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-700 text-white">
                <ChatCircleDots size={18} weight="fill" />
              </span>
              <span className="font-display text-lg font-extrabold tracking-tight">CSQ</span>
            </Link>
            <p className="max-w-[220px] text-[0.85rem] leading-[1.6] text-[#888]">
              Layanan pelanggan AI untuk UMKM Indonesia, di WhatsApp.
            </p>
          </div>
          {/* Navigation */}
          <FooterCol
            title="Navigasi"
            links={[{ label: "Fitur", href: "#fitur" }, { label: "Cara Kerja", href: "#cara-kerja" }, { label: "Biaya", href: "#biaya" }, { label: "FAQ", href: "#faq" }]}
          />
          {/* Pages */}
          <FooterCol
            title="Halaman"
            links={[{ label: "Home", href: "/" }, { label: "Masuk", href: "/login" }, { label: "Daftar", href: "/register" }]}
          />
          {/* Newsletter */}
          <div>
            <h4 className="mb-5 text-[0.95rem] font-semibold text-neutral-900">Newsletter</h4>
            <p className="mb-[15px] text-[0.85rem] text-[#888]">Dapatkan pembaruan CSQ di email Anda.</p>
            <div className="flex flex-col gap-[10px] sm:flex-row">
              <input
                type="email"
                placeholder="Masukkan email..."
                className="flex-grow border border-[#f0f0f0] bg-white text-[0.9rem] outline-none transition-colors duration-200 focus:border-[#ccc]"
                style={{ padding: "12px 16px", borderRadius: "10px", boxShadow: "inset 0 1px 3px rgba(0,0,0,0.02)" }}
              />
              <button
                className="bg-neutral-900 text-white border-none font-semibold cursor-pointer text-[0.9rem] transition-all duration-200 hover:-translate-y-0.5 w-full sm:w-auto"
                style={{ padding: "12px 28px", borderRadius: "10px", boxShadow: "0 12px 24px rgba(0,0,0,0.4)" }}
              >
                Subscribe
              </button>
            </div>
          </div>
        </div>
        <div className="flex justify-between border-t border-[#f0f0f0] pt-[25px] pb-[10px] text-[0.85rem] text-[#888] max-[480px]:flex-col max-[480px]:gap-[15px] max-[480px]:items-center">
          <p>Semua hak dilindungi. &copy; {new Date().getFullYear()} {SITE_NAME}.</p>
          <p>Self-host untuk UMKM Indonesia.</p>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <h4 className="mb-5 text-[0.95rem] font-semibold text-neutral-900">{title}</h4>
      <ul>
        {links.map((l) => (
          <li key={l.label} className="mb-3">
            <Link href={l.href} className="text-[0.85rem] text-[#888] no-underline transition-colors duration-200 hover:text-neutral-900">{l.label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
