// CSQ marketing landing page — the public front door at /.
//
// Design thesis: the product IS a conversation, so the hero is a live
// WhatsApp-style chat that plays the safety moment (agent quotes from business
// data, then refuses an unauthorized price change). The page alternates between
// "document" (white datasheet) and "conversation" (green-tinted) registers.
// Color encodes the core rule: green = agent reads/acts, amber = human approval
// gate, deep forest ink = the principle section. Motion: hero typewriter,
// IntersectionObserver scroll-reveals, one parallax on the principle headline —
// all disabled under prefers-reduced-motion.
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ChatCircleDots,
  ArrowRight,
  Check,
  Plus,
  Minus,
  WhatsappLogo,
  Robot,
  Database,
  Books,
  ShieldCheck,
  ListChecks,
  HardDrives,
  FileText,
  Table,
  PencilSimple,
  Sparkle,
} from "@phosphor-icons/react";
import { Seo, SITE_NAME, SITE_TAGLINE, DEFAULT_DESCRIPTION } from "@/components/seo";
import { Reveal } from "@/components/landing/reveal";
import { HeroChat } from "@/components/landing/hero-chat";

type Feature = {
  index: string;
  title: string;
  body: string;
  icon: typeof Robot;
};

const FEATURES: Feature[] = [
  {
    index: "F-01",
    title: "Agent CSAI di WhatsApp",
    body: "Deploy AI Customer Service di WhatsApp — Cloud API resmi atau nomor Anda sendiri. Inbox bersama tim, handoff ke manusia, dan template pesan untuk luar jendela 24 jam.",
    icon: WhatsappLogo,
  },
  {
    index: "F-02",
    title: "Baca data yang sudah Anda punya",
    body: "Excel, CSV, Google Sheets, input manual, dan dokumen dinormalisasi lewat Business Context Layer. Agent tidak peduli dari mana datanya — ia membacanya seperti staf Anda.",
    icon: Database,
  },
  {
    index: "F-03",
    title: "Pengetahuan & memori bisnis",
    body: "Knowledge base, FAQ, aturan, dan memori agen dengan pencarian pgvector. Agent mengambil konteks yang relevan saat dibutuhkan — bukan dijejalkan utuh setiap percakapan.",
    icon: Books,
  },
  {
    index: "F-04",
    title: "Izin per-aksi + approval",
    body: "Baca secara default. Menulis adalah izin per-tool: product.update, inventory.update, order.create. Aksi sensitif butuh persetujuan Anda sebelum dijalankan.",
    icon: ShieldCheck,
  },
  {
    index: "F-05",
    title: "Audit penuh",
    body: "Setiap aksi tercatat — sebelum dan sesudah, siapa, dan kapan. Anda tahu persis apa yang dibaca agent dan apa yang diubah, lengkap dengan status persetujuan.",
    icon: ListChecks,
  },
  {
    index: "F-06",
    title: "Multi-tenant & self-host",
    body: "Setiap UMKM dapat sel terisolasi: data, kredensial, dan memori sendiri. Deploy di server Anda dengan Docker Compose. Data tetap milik Anda, di kendali Anda.",
    icon: HardDrives,
  },
];

const STEPS: { n: string; title: string; body: string }[] = [
  {
    n: "01",
    title: "Sambungkan data",
    body: "Impor Excel/CSV, hubungkan Google Sheets, atau input manual. Agent langsung membaca stok, produk, harga, dan kebijakan Anda.",
  },
  {
    n: "02",
    title: "Ajarkan agent",
    body: "Tambahkan FAQ, kebijakan, dan aturan bisnis. Atur persona dan instruksi owner. Agent mengambil yang relevan via pencarian, bukan menghafal semuanya.",
  },
  {
    n: "03",
    title: "Atur izin",
    body: "Pilih apa yang boleh dibaca dan diubah per tool. Tentukan aksi yang butuh persetujuan Anda. Default: baca saja.",
  },
  {
    n: "04",
    title: "Deploy ke WhatsApp",
    body: "Pilih Cloud API resmi atau nomor Anda sendiri via Baileys. Agent mulai melayani pelanggan langsung di WhatsApp.",
  },
  {
    n: "05",
    title: "Pantau & ambil alih",
    body: "Inbox bersama: lihat percakapan, tag, tugaskan, dan ambil alih dari AI kapan saja. Approval masuk untuk aksi yang butuh Anda.",
  },
];

const FAQS: { q: string; a: string }[] = [
  {
    q: "Apakah saya butuh coding?",
    a: "Tidak. CSQ dirancang untuk owner UMKM. Hubungkan data, ajarkan aturan, dan atur izin lewat dashboard — tanpa kode.",
  },
  {
    q: "Apakah datanya aman?",
    a: "CSQ self-host: deploy di server Anda sendiri dengan Docker Compose. Data bisnis dan pelanggan tetap di kendali Anda, terisolasi per tenant.",
  },
  {
    q: "Bisa pakai nomor WhatsApp saya sendiri?",
    a: "Bisa. Pilih Cloud API resmi Meta (ToS-safe, nomor khusus) atau Baileys dengan nomor Anda sendiri via QR. Owner memilih saat onboarding; keduanya tersedia.",
  },
  {
    q: "Bagaimana kalau AI salah jawab atau berbuat di luar batas?",
    a: "Agent baca secara default dan hanya menulis dengan izin per-tool. Aksi sensitif butuh persetujuan owner. Setiap aksi tercatat untuk audit, dan Anda bisa ambil alih kapan saja.",
  },
  {
    q: "Berapa harganya?",
    a: "CSQ open untuk dihosting sendiri. Anda hanya menanggung server (VPS kecil sudah cukup) dan biaya WhatsApp Cloud API sesuai pemakaian.",
  },
];

const SOURCES = [
  { label: "Excel / CSV", icon: Table },
  { label: "Google Sheets", icon: FileText },
  { label: "Input manual", icon: PencilSimple },
  { label: "Dokumen", icon: FileText },
];

const jsonLd = [
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    description: DEFAULT_DESCRIPTION,
    logo: "/icon.svg",
  },
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    inLanguage: "id-ID",
    url: "/",
  },
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: SITE_NAME,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    description: DEFAULT_DESCRIPTION,
    offers: { "@type": "Offer", price: "0", priceCurrency: "IDR" },
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  },
];

export default function Home() {
  // Parallax for the principle headline: set --parallax on the section (inherited
  // by the .parallax child) based on scroll position. Skipped under reduced motion.
  const parallaxSectionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    function update() {
      const el = parallaxSectionRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const vh = window.innerHeight;
      const center = rect.top + rect.height / 2;
      const delta = (center - vh / 2) / vh; // ~ -1 (below) .. +1 (above)
      el.style.setProperty("--parallax", `${Math.max(-1, Math.min(1, delta)) * -42}px`);
    }
    function onScroll() {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(update);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <>
      <Seo
        title={undefined}
        description={DEFAULT_DESCRIPTION}
        path="/"
        jsonLd={jsonLd}
      />

      <div className="min-h-screen bg-white text-slate-900">
        <Navbar />
        <Hero />
        <PrincipleTicker />
        <Positioning />
        <Features />
        <HowItWorks />
        <Principle parallaxRef={parallaxSectionRef} />
        <Faq />
        <CtaBand />
        <Footer />
      </div>
    </>
  );
}

/* ----------------------------- Navbar ----------------------------- */

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
    <header
      className={
        "sticky top-0 z-50 transition-colors " +
        (scrolled ? "border-b border-slate-200 bg-white/85 backdrop-blur" : "border-b border-transparent bg-transparent")
      }
    >
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-600 text-white">
            <ChatCircleDots size={20} weight="fill" />
          </span>
          <span className="font-display text-lg font-extrabold tracking-tight">CSQ</span>
        </Link>

        <div className="hidden items-center gap-7 text-sm text-slate-600 md:flex">
          <a href="#fitur" className="hover:text-slate-900">Fitur</a>
          <a href="#cara-kerja" className="hover:text-slate-900">Cara Kerja</a>
          <a href="#prinsip" className="hover:text-slate-900">Keamanan</a>
          <a href="#faq" className="hover:text-slate-900">FAQ</a>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <Link
            href="/login"
            className="hidden rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 sm:block"
          >
            Masuk
          </Link>
          <Link
            href="/register"
            className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3.5 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-green-700"
          >
            Coba gratis <ArrowRight size={15} weight="bold" />
          </Link>
        </div>
      </nav>
    </header>
  );
}

/* ------------------------------ Hero ------------------------------ */

function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* Ambient background: soft green radial + faint dot grid */}
      <div
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          backgroundImage:
            "radial-gradient(60% 50% at 70% 0%, rgba(22,163,74,0.10), transparent 70%)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-0 -z-10 opacity-[0.5]"
        style={{
          backgroundImage:
            "radial-gradient(rgba(15,42,29,0.06) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
          maskImage: "linear-gradient(to bottom, black, transparent 80%)",
          WebkitMaskImage: "linear-gradient(to bottom, black, transparent 80%)",
        }}
      />

      <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-14 sm:px-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8 lg:pb-28 lg:pt-20">
        {/* Copy */}
        <div>
          <p className="rise-in font-mono-data text-xs font-medium uppercase tracking-[0.18em] text-green-700">
            Agent Pelayanan Pelanggan · WhatsApp
          </p>
          <h1
            className="rise-in mt-5 font-display text-4xl font-extrabold leading-[1.05] tracking-tight text-slate-900 sm:text-5xl lg:text-6xl"
            style={{ animationDelay: "60ms" }}
          >
            AI yang mengenal
            <br />
            bisnis Anda,
            <br />
            <span className="text-green-700">bicara ke pelanggan</span>
            <br />
            di WhatsApp.
          </h1>
          <p
            className="rise-in mt-6 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg"
            style={{ animationDelay: "140ms" }}
          >
            CSQ adalah agen AI self-host untuk UMKM Indonesia. Ia membaca stok,
            harga, dan kebijakan dari data yang sudah Anda punya — lalu melayani
            pelanggan di WhatsApp. Menjawab secara default, menulis dengan izin
            Anda.
          </p>
          <div
            className="rise-in mt-8 flex flex-wrap items-center gap-3"
            style={{ animationDelay: "220ms" }}
          >
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-xl bg-green-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-green-600/20 transition-transform hover:-translate-y-0.5 hover:bg-green-700"
            >
              Mulai gratis <ArrowRight size={16} weight="bold" />
            </Link>
            <a
              href="#cara-kerja"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              Lihat cara kerja
            </a>
          </div>
          <p
            className="rise-in mt-6 flex items-center gap-2 text-xs text-slate-500"
            style={{ animationDelay: "300ms" }}
          >
            <ShieldCheck size={15} className="text-green-600" />
            Data tetap milik Anda. Self-host dengan Docker Compose.
          </p>
        </div>

        {/* Live chat */}
        <div className="rise-in flex justify-center lg:justify-end" style={{ animationDelay: "180ms" }}>
          <HeroChat />
        </div>
      </div>
    </section>
  );
}

/* ------------------------ Principle ticker ------------------------ */

function PrincipleTicker() {
  const items = [
    "BACA SECARA DEFAULT",
    "TULIS DENGAN IZIN",
    "BERTINDAK SESUAI ATURAN",
  ];
  const sequence = [...items, ...items, ...items, ...items];
  return (
    <div className="border-y border-slate-200 bg-slate-50 py-3.5">
      <div className="overflow-hidden">
        <div className="marquee">
          <span className="font-mono-data text-sm font-medium uppercase tracking-[0.14em] text-slate-500">
            {sequence.map((t, i) => (
              <span key={i} className="mx-6 inline-flex items-center gap-3">
                <span className="h-1.5 w-1.5 rounded-full bg-green-600" />
                {t}
              </span>
            ))}
          </span>
          {/* duplicate for seamless loop */}
          <span className="font-mono-data text-sm font-medium uppercase tracking-[0.14em] text-slate-500" aria-hidden>
            {sequence.map((t, i) => (
              <span key={i} className="mx-6 inline-flex items-center gap-3">
                <span className="h-1.5 w-1.5 rounded-full bg-green-600" />
                {t}
              </span>
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}

/* --------------------------- Positioning --------------------------- */

function Positioning() {
  return (
    <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:py-28">
      <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
        <Reveal>
          <p className="font-mono-data text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
            Posisi
          </p>
          <h2 className="mt-4 font-display text-3xl font-bold leading-tight tracking-tight text-slate-900 sm:text-4xl">
            Bisnis Anda tidak perlu berubah agar AI bisa bekerja untuk Anda.
          </h2>
          <p className="mt-5 max-w-lg text-base leading-relaxed text-slate-600">
            Agent membaca data dari tempat Anda sudah menyimpannya — spreadsheet,
            Sheets, catatan manual. Tidak ada migrasi, tidak ada format baru. Ia
            belajar aturan Anda, dan bertindak sesuai izin yang Anda tentukan.
          </p>
        </Reveal>

        <Reveal delay={120}>
          <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-6">
            <p className="mb-4 font-mono-data text-xs uppercase tracking-wider text-slate-400">
              Sumber data yang didukung
            </p>
            <div className="grid grid-cols-2 gap-3">
              {SOURCES.map((s) => (
                <div
                  key={s.label}
                  className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3.5"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-50 text-green-700">
                    <s.icon size={18} />
                  </span>
                  <span className="text-sm font-medium text-slate-700">{s.label}</span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-2 rounded-xl bg-green-50 px-4 py-3 text-sm text-green-800">
              <Sparkle size={16} weight="fill" />
              Dinormalisasi lewat Business Context Layer — agent membacanya seperti satu sumber.
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ----------------------------- Features ----------------------------- */

function Features() {
  return (
    <section id="fitur" className="border-y border-slate-200 bg-white py-20 lg:py-28">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal>
          <p className="font-mono-data text-xs font-medium uppercase tracking-[0.18em] text-green-700">
            Spesifikasi
          </p>
          <h2 className="mt-4 max-w-2xl font-display text-3xl font-bold leading-tight tracking-tight text-slate-900 sm:text-4xl">
            Semua yang agent butuh untuk melayani, dan Anda butuh untuk mengontrol.
          </h2>
        </Reveal>

        <div className="mt-14 divide-y divide-slate-200 border-t border-slate-200">
          {FEATURES.map((f, i) => (
            <Reveal key={f.index} delay={i * 60}>
              <div className="grid gap-5 py-8 sm:grid-cols-[auto_1fr] sm:items-start sm:gap-8">
                <div className="flex items-center gap-4 sm:w-44 sm:flex-col sm:items-start sm:gap-3">
                  <span className="font-mono-data text-sm font-semibold text-slate-400">{f.index}</span>
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-600 text-white">
                    <f.icon size={20} weight="fill" />
                  </span>
                </div>
                <div className="max-w-2xl">
                  <h3 className="font-display text-xl font-bold tracking-tight text-slate-900">{f.title}</h3>
                  <p className="mt-2 text-base leading-relaxed text-slate-600">{f.body}</p>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* --------------------------- How it works --------------------------- */

function HowItWorks() {
  return (
    <section id="cara-kerja" className="bg-slate-50 py-20 lg:py-28">
      <div className="mx-auto max-w-4xl px-5 sm:px-8">
        <Reveal>
          <p className="font-mono-data text-xs font-medium uppercase tracking-[0.18em] text-slate-400">
            Alur kerja
          </p>
          <h2 className="mt-4 font-display text-3xl font-bold leading-tight tracking-tight text-slate-900 sm:text-4xl">
            Dari data ke AI yang melayani, dalam lima langkah.
          </h2>
        </Reveal>

        <ol className="mt-12 space-y-0">
          {STEPS.map((s, i) => (
            <Reveal key={s.n} delay={i * 70}>
              <li className="relative grid grid-cols-[auto_1fr] gap-5 pb-10 last:pb-0">
                {/* timeline rail */}
                <div className="flex flex-col items-center">
                  <span className="font-mono-data text-lg font-bold text-green-700">{s.n}</span>
                  {i < STEPS.length - 1 && <span className="mt-2 w-px flex-1 bg-slate-200" />}
                </div>
                <div className="pt-0.5">
                  <h3 className="font-display text-lg font-bold tracking-tight text-slate-900">{s.title}</h3>
                  <p className="mt-1.5 max-w-xl text-base leading-relaxed text-slate-600">{s.body}</p>
                </div>
              </li>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ---------------------- Principle (parallax) ---------------------- */

function Principle({ parallaxRef }: { parallaxRef: React.RefObject<HTMLDivElement> }) {
  return (
    <section
      id="prinsip"
      ref={parallaxRef}
      className="relative overflow-hidden bg-[#0f2a1d] py-28 text-white lg:py-40"
    >
      {/* ambient glow */}
      <div
        className="pointer-events-none absolute inset-0 -z-0 opacity-60"
        style={{ backgroundImage: "radial-gradient(50% 60% at 20% 30%, rgba(22,163,74,0.25), transparent 70%)" }}
      />
      <div className="relative mx-auto max-w-5xl px-5 text-center sm:px-8">
        <Reveal>
          <p className="font-mono-data text-xs font-medium uppercase tracking-[0.2em] text-[#e2b50a]">
            Prinsip inti
          </p>
        </Reveal>
        <Reveal delay={100}>
          <h2 className="parallax mt-6 font-display text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-6xl lg:text-7xl">
            Baca secara default.
            <br />
            Tulis dengan izin.
            <br />
            <span className="text-green-400">Bertindak sesuai aturan.</span>
          </h2>
        </Reveal>
        <Reveal delay={200}>
          <p className="mx-auto mt-8 max-w-2xl text-base leading-relaxed text-green-100/80 sm:text-lg">
            Agent dirancang untuk membaca dan menjawab. Setiap aksi yang mengubah
            data — stok, harga, pesanan — adalah izin terpisah, dan sebagian butuh
            persetujuan Anda. Anda yang memegang kendali, agent yang bekerja.
          </p>
        </Reveal>

        <Reveal delay={260}>
          <div className="mx-auto mt-10 flex max-w-md flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 p-5 text-left sm:flex-row sm:items-center sm:justify-between">
            <PermissionToggle label="Membaca produk & stok" defaultOn />
            <PermissionToggle label="Mengubah harga" defaultOn={false} needsApproval />
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function PermissionToggle({
  label,
  defaultOn,
  needsApproval = false,
}: {
  label: string;
  defaultOn: boolean;
  needsApproval?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl bg-white/5 px-4 py-3">
      <span className="text-sm text-green-50">{label}</span>
      <span
        className={
          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold " +
          (needsApproval
            ? "bg-[#e2b50a]/15 text-[#e2b50a]"
            : defaultOn
              ? "bg-green-500/20 text-green-300"
              : "bg-white/10 text-green-100/60")
        }
      >
        {needsApproval ? <ShieldCheck size={13} weight="fill" /> : defaultOn ? <Check size={13} weight="bold" /> : null}
        {needsApproval ? "Perlu izin" : defaultOn ? "Boleh" : "Diblokir"}
      </span>
    </div>
  );
}

/* ------------------------------- FAQ ------------------------------- */

function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-3xl px-5 py-20 sm:px-8 lg:py-28">
      <Reveal>
        <p className="font-mono-data text-xs font-medium uppercase tracking-[0.18em] text-slate-400">FAQ</p>
        <h2 className="mt-4 font-display text-3xl font-bold leading-tight tracking-tight text-slate-900 sm:text-4xl">
          Pertanyaan yang sering muncul.
        </h2>
      </Reveal>

      <div className="mt-10 divide-y divide-slate-200 border-t border-slate-200">
        {FAQS.map((f, i) => (
          <Reveal key={f.q} delay={i * 50}>
            <details className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4">
                <span className="font-display text-base font-semibold text-slate-900 sm:text-lg">{f.q}</span>
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition-transform group-open:rotate-180">
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

/* ----------------------------- CTA band ----------------------------- */

function CtaBand() {
  return (
    <section className="px-5 pb-24 sm:px-8">
      <div className="mx-auto max-w-5xl overflow-hidden rounded-3xl bg-green-700 px-6 py-14 text-center text-white sm:px-12 lg:py-20">
        <Reveal>
          <h2 className="font-display text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
            Siap membuat AI bekerja untuk usaha Anda?
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-base text-green-100 sm:text-lg">
            Hubungkan data, ajarkan aturan, atur izin — lalu deploy agent ke
            WhatsApp dalam hitungan menit.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-green-800 shadow-lg transition-transform hover:-translate-y-0.5"
            >
              Mulai gratis <ArrowRight size={16} weight="bold" />
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 rounded-xl border border-white/30 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
            >
              Masuk dashboard
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ------------------------------ Footer ------------------------------ */

function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-5 py-14 sm:px-8">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-1">
            <Link href="/" className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-600 text-white">
                <ChatCircleDots size={20} weight="fill" />
              </span>
              <span className="font-display text-lg font-extrabold tracking-tight">CSQ</span>
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-slate-500">
              {SITE_TAGLINE}. Self-host, multi-tenant, data tetap milik Anda.
            </p>
          </div>

          <FooterCol
            title="Produk"
            links={[
              { label: "Fitur", href: "#fitur" },
              { label: "Cara Kerja", href: "#cara-kerja" },
              { label: "Keamanan", href: "#prinsip" },
              { label: "FAQ", href: "#faq" },
            ]}
          />
          <FooterCol
            title="Mulai"
            links={[
              { label: "Daftar", href: "/register" },
              { label: "Masuk", href: "/login" },
              { label: "Dashboard", href: "/dashboard" },
            ]}
          />
          <div>
            <p className="font-mono-data text-xs font-medium uppercase tracking-wider text-slate-400">Prinsip</p>
            <p className="mt-4 text-sm leading-relaxed text-slate-600">
              Baca secara default.
              <br />
              Tulis dengan izin.
              <br />
              Bertindak sesuai aturan.
            </p>
          </div>
        </div>

        <div className="mt-12 flex flex-col items-start justify-between gap-3 border-t border-slate-200 pt-6 text-xs text-slate-400 sm:flex-row sm:items-center">
          <p>© {new Date().getFullYear()} {SITE_NAME}. Dibuat untuk UMKM Indonesia.</p>
          <p className="font-mono-data uppercase tracking-wider">Self-hosted · Docker Compose</p>
        </div>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <p className="font-mono-data text-xs font-medium uppercase tracking-wider text-slate-400">{title}</p>
      <ul className="mt-4 space-y-2.5 text-sm">
        {links.map((l) => (
          <li key={l.label}>
            <Link href={l.href} className="text-slate-600 transition-colors hover:text-slate-900">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
