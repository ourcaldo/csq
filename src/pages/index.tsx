// CSQ marketing landing page — public front door at /.
//
// Design intent: clean, professional, restrained. White surface, one accent
// (CSQ green), strong typographic hierarchy, and a hero visual that is the
// real product UI in a browser frame — not a staged phone or animated chat.
// Motion is limited to subtle scroll fade-ins. No stock portraits, no count-up
// stats, no "trusted by" walls, no dark acid-green panels.
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ChatCircleDots,
  ArrowRight,
  Check,
  Plus,
  Minus,
  WhatsappLogo,
  Database,
  ShieldCheck,
  Kanban,
  FileText,
  Table,
  PencilSimple,
  Users,
} from "@phosphor-icons/react";
import { Seo, SITE_NAME, SITE_TAGLINE, DEFAULT_DESCRIPTION } from "@/components/seo";
import { Reveal } from "@/components/landing/reveal";
import { HeroPreview } from "@/components/landing/hero-preview";

const STEPS = [
  { n: "01", title: "Sambungkan data", body: "Impor Excel/CSV, hubungkan Google Sheets, atau input manual. Agent membaca stok, produk, harga, dan kebijakan Anda dari sumber yang sudah ada." },
  { n: "02", title: "Atur izin & ajarkan", body: "Pilih apa yang boleh dibaca dan diubah per tool. Tambahkan FAQ dan aturan. Aksi sensitif butuh persetujuan Anda. Default: baca saja." },
  { n: "03", title: "Deploy ke WhatsApp", body: "Pilih Cloud API resmi atau nomor Anda sendiri. Agent melayani pelanggan, sementara Anda memantau dan mengambil alih dari inbox bersama kapan saja." },
];

const FEATURES = [
  {
    title: "Inbox bersama: tim dan AI satu layar",
    body: "Owner dan staff bekerja berdampingan dengan agent di inbox CRM. Lihat percakapan, beri tag, tugaskan, dan ambil alih dari AI — agent berdiri sementara, lalu kembali saat dilepas.",
    icon: Kanban,
    visual: "inbox" as const,
  },
  {
    title: "Membaca data yang sudah Anda punya",
    body: "Excel, CSV, Google Sheets, input manual, dan dokumen dinormalisasi lewat Business Context Layer. Agent tidak peduli dari mana datanya — ia membacanya seperti staf Anda.",
    icon: Database,
    visual: "data" as const,
  },
  {
    title: "Izin per-aksi dan audit penuh",
    body: "Membaca secara default. Menulis adalah izin terpisah per-tool, dan aksi sensitif butuh persetujuan owner. Setiap aksi tercatat — sebelum dan sesudah, siapa, dan kapan.",
    icon: ShieldCheck,
    visual: "perms" as const,
  },
];

const CHANNELS = [
  { label: "WhatsApp", icon: WhatsappLogo },
  { label: "Google Sheets", icon: FileText },
  { label: "Excel / CSV", icon: Table },
  { label: "Input manual", icon: PencilSimple },
  { label: "Dokumen PDF", icon: FileText },
];

const FAQS: { q: string; a: string }[] = [
  { q: "Apakah saya butuh coding?", a: "Tidak. CSQ dirancang untuk owner UMKM. Hubungkan data, ajarkan aturan, dan atur izin lewat dashboard — tanpa kode." },
  { q: "Apakah datanya aman?", a: "CSQ self-host: deploy di server Anda sendiri dengan Docker Compose. Data bisnis dan pelanggan tetap di kendali Anda, terisolasi per tenant." },
  { q: "Bisa pakai nomor WhatsApp saya sendiri?", a: "Bisa. Pilih Cloud API resmi Meta (ToS-safe, nomor khusus) atau Baileys dengan nomor Anda sendiri via QR. Owner memilih saat onboarding; keduanya tersedia." },
  { q: "Bagaimana kalau AI salah jawab atau berbuat di luar batas?", a: "Agent baca secara default dan hanya menulis dengan izin per-tool. Aksi sensitif butuh persetujuan owner. Setiap aksi tercatat untuk audit, dan Anda bisa ambil alih kapan saja." },
  { q: "Berapa harganya?", a: "CSQ open untuk dihosting sendiri. Anda hanya menanggung server (VPS kecil sudah cukup) dan biaya WhatsApp Cloud API sesuai pemakaian." },
];

const jsonLd = [
  { "@context": "https://schema.org", "@type": "Organization", name: SITE_NAME, description: DEFAULT_DESCRIPTION, logo: "/icon.svg" },
  { "@context": "https://schema.org", "@type": "WebSite", name: SITE_NAME, inLanguage: "id-ID", url: "/" },
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
    mainEntity: FAQS.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  },
];

export default function Home() {
  return (
    <>
      <Seo description={DEFAULT_DESCRIPTION} path="/" jsonLd={jsonLd} />
      <div className="min-h-screen bg-white text-slate-900">
        <Navbar />
        <Hero />
        <Channels />
        <HowItWorks />
        <Features />
        <Principle />
        <Faq />
        <Cta />
        <Footer />
      </div>
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
    <header className={"sticky top-0 z-50 bg-white/90 backdrop-blur transition-shadow " + (scrolled ? "shadow-sm ring-1 ring-slate-200/60" : "")}>
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-600 text-white">
            <ChatCircleDots size={20} weight="fill" />
          </span>
          <span className="font-display text-lg font-extrabold tracking-tight">CSQ</span>
        </Link>
        <div className="hidden items-center gap-7 text-sm text-slate-600 md:flex">
          <a href="#cara-kerja" className="hover:text-slate-900">Cara Kerja</a>
          <a href="#fitur" className="hover:text-slate-900">Fitur</a>
          <a href="#keamanan" className="hover:text-slate-900">Keamanan</a>
          <a href="#faq" className="hover:text-slate-900">FAQ</a>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/login" className="hidden text-sm font-medium text-slate-600 hover:text-slate-900 sm:block">Masuk</Link>
          <Link href="/register" className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-700">
            Coba gratis <ArrowRight size={14} weight="bold" />
          </Link>
        </div>
      </nav>
    </header>
  );
}

/* -------------------------------- Hero -------------------------------- */

function Hero() {
  return (
    <section className="relative overflow-hidden border-b border-slate-100">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-16 pt-12 sm:px-8 lg:grid-cols-2 lg:gap-10 lg:pb-24 lg:pt-20">
        <div>
          <p className="rise-in font-mono-data text-[11px] font-medium uppercase tracking-[0.18em] text-green-700">
            AI Customer Service · WhatsApp · Self-host
          </p>
          <h1 className="rise-in mt-5 font-display text-4xl font-extrabold leading-[1.08] tracking-tight text-slate-900 sm:text-5xl lg:text-[3.4rem]" style={{ animationDelay: "60ms" }}>
            Agen AI layanan pelanggan di WhatsApp yang memahami{" "}
            <span className="text-green-700">data bisnis Anda</span>.
          </h1>
          <p className="rise-in mt-6 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg" style={{ animationDelay: "140ms" }}>
            CSQ membaca stok, harga, dan kebijakan dari data yang sudah Anda punya, lalu melayani pelanggan di WhatsApp. Membaca secara default, menulis dengan izin Anda.
          </p>
          <div className="rise-in mt-8 flex flex-wrap items-center gap-3" style={{ animationDelay: "220ms" }}>
            <Link href="/register" className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-green-700">
              Coba gratis <ArrowRight size={15} weight="bold" />
            </Link>
            <a href="#cara-kerja" className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50">
              Pelajari cara kerja
            </a>
          </div>
          <p className="rise-in mt-5 text-xs text-slate-500" style={{ animationDelay: "300ms" }}>
            Tanpa kartu kredit. Data tetap milik Anda.
          </p>
        </div>

        <div className="rise-in lg:pl-4" style={{ animationDelay: "180ms" }}>
          <HeroPreview />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------ Channels ------------------------------ */

function Channels() {
  return (
    <section className="border-b border-slate-100 bg-slate-50/50 py-8">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-6 gap-y-3 px-5 sm:px-8">
        <span className="text-xs font-medium uppercase tracking-wider text-slate-400">Terhubung ke</span>
        {CHANNELS.map((c) => (
          <span key={c.label} className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500">
            <c.icon size={16} className="text-slate-400" /> {c.label}
          </span>
        ))}
      </div>
    </section>
  );
}

/* ----------------------------- How it works ----------------------------- */

function HowItWorks() {
  return (
    <section id="cara-kerja" className="mx-auto max-w-6xl px-5 py-20 sm:px-8 lg:py-28">
      <Reveal>
        <p className="font-mono-data text-xs font-medium uppercase tracking-[0.18em] text-slate-400">Cara kerja</p>
        <h2 className="mt-4 max-w-2xl font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          Dari data ke AI yang melayani, dalam tiga langkah.
        </h2>
      </Reveal>
      <div className="mt-12 grid gap-8 md:grid-cols-3">
        {STEPS.map((s, i) => (
          <Reveal key={s.n} delay={i * 80}>
            <div className="border-t border-slate-200 pt-5">
              <p className="font-mono-data text-sm font-semibold text-green-700">{s.n}</p>
              <h3 className="mt-3 font-display text-lg font-bold tracking-tight text-slate-900">{s.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-600">{s.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

/* ------------------------------ Features ------------------------------ */

function Features() {
  return (
    <section id="fitur" className="border-y border-slate-100 bg-slate-50/50 py-20 lg:py-28">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal>
          <p className="font-mono-data text-xs font-medium uppercase tracking-[0.18em] text-slate-400">Fitur</p>
          <h2 className="mt-4 max-w-2xl font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Semua yang agent butuh untuk melayani, Anda butuh untuk mengontrol.
          </h2>
        </Reveal>

        <div className="mt-16 space-y-20">
          {FEATURES.map((f, i) => (
            <Reveal key={f.title}>
              <div className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
                <div className={i % 2 === 1 ? "lg:order-2" : ""}>
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-green-600 text-white">
                    <f.icon size={20} weight="fill" />
                  </span>
                  <h3 className="mt-5 font-display text-2xl font-bold tracking-tight text-slate-900">{f.title}</h3>
                  <p className="mt-3 max-w-lg text-base leading-relaxed text-slate-600">{f.body}</p>
                </div>
                <div className={i % 2 === 1 ? "lg:order-1" : ""}>
                  <FeatureVisual kind={f.visual} />
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

function FeatureVisual({ kind }: { kind: "inbox" | "data" | "perms" }) {
  if (kind === "inbox") {
    return (
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-3 py-2 text-[11px] text-slate-400">Inbox · Percakapan</div>
        <div className="space-y-1.5 p-3">
          {[
            { n: "Rina — Toko Kopi", p: "Bisa Rp50.000?", a: true },
            { n: "Dewi Catering", p: "Pesanan sabtu", a: false },
            { n: "Warung Bu Tini", p: "Ada robusta?", a: false },
          ].map((r) => (
            <div key={r.n} className={"rounded-lg border px-3 py-2 " + (r.a ? "border-green-200 bg-green-50/50" : "border-slate-100")}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-900">{r.n}</p>
                {r.a && <span className="rounded-full bg-green-100 px-2 py-0.5 text-[9px] font-medium text-green-700">AI</span>}
              </div>
              <p className="text-[11px] text-slate-500">{r.p}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }
  if (kind === "data") {
    const srcs = ["Excel/CSV", "Google Sheets", "Manual", "PDF"];
    return (
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <p className="mb-4 font-mono-data text-[11px] uppercase tracking-wider text-slate-400">Sumber data → Business Context Layer</p>
        <div className="grid grid-cols-2 gap-3">
          {srcs.map((s) => (
            <div key={s} className="rounded-lg border border-slate-200 px-3 py-2.5 text-sm font-medium text-slate-700">{s}</div>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2.5 text-xs text-green-800">
          <Check size={14} weight="bold" /> Dinormalisasi menjadi satu sumber yang dapat dibaca agent.
        </div>
      </div>
    );
  }
  const rows = [
    { l: "Membaca produk & stok", s: "Boleh" as const },
    { l: "Membuat pesanan", s: "Boleh" as const },
    { l: "Mengubah harga", s: "Perlu izin" as const },
    { l: "Menghapus data", s: "Diblokir" as const },
  ];
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="mb-4 font-mono-data text-[11px] uppercase tracking-wider text-slate-400">Izin per-aksi</p>
      <div className="space-y-3">
        {rows.map((r) => (
          <div key={r.l} className="flex items-center justify-between">
            <span className="text-sm text-slate-700">{r.l}</span>
            <span
              className={
                "rounded-full px-2.5 py-0.5 text-[11px] font-semibold " +
                (r.s === "Boleh" ? "bg-green-100 text-green-700" : r.s === "Perlu izin" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500")
              }
            >
              {r.s}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------ Principle ------------------------------ */

function Principle() {
  return (
    <section id="keamanan" className="bg-green-700 py-20 text-white lg:py-28">
      <div className="mx-auto max-w-4xl px-5 text-center sm:px-8">
        <Reveal>
          <p className="font-mono-data text-xs font-medium uppercase tracking-[0.2em] text-green-200">Prinsip inti</p>
          <h2 className="mt-6 font-display text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
            Baca secara default.<br /> Tulis dengan izin.<br /> Bertindak sesuai aturan.
          </h2>
          <p className="mx-auto mt-7 max-w-2xl text-base leading-relaxed text-green-100/90">
            Agent dirancang untuk membaca dan menjawab. Setiap aksi yang mengubah data adalah izin terpisah, dan sebagian butuh persetujuan Anda. Anda yang memegang kendali, agent yang bekerja.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-green-50">
            <span className="inline-flex items-center gap-2"><Check size={16} weight="bold" /> Izin per-tool</span>
            <span className="inline-flex items-center gap-2"><Check size={16} weight="bold" /> Approval owner</span>
            <span className="inline-flex items-center gap-2"><Check size={16} weight="bold" /> Audit sebelum/sesudah</span>
            <span className="inline-flex items-center gap-2"><Users size={16} /> Ambil alih kapan saja</span>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* -------------------------------- FAQ -------------------------------- */

function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-3xl px-5 py-20 sm:px-8 lg:py-28">
      <Reveal>
        <p className="font-mono-data text-xs font-medium uppercase tracking-[0.18em] text-slate-400">FAQ</p>
        <h2 className="mt-4 font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">Pertanyaan yang sering muncul.</h2>
      </Reveal>
      <div className="mt-10 divide-y divide-slate-200 border-t border-slate-200">
        {FAQS.map((f, i) => (
          <Reveal key={f.q} delay={i * 40}>
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

/* -------------------------------- CTA -------------------------------- */

function Cta() {
  return (
    <section className="mx-auto max-w-6xl px-5 pb-24 sm:px-8">
      <div className="rounded-2xl border border-slate-200 bg-slate-50/60 px-6 py-14 text-center sm:px-12">
        <Reveal>
          <h2 className="font-display text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            Siap membuat AI bekerja untuk usaha Anda?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base text-slate-600">
            Hubungkan data, ajarkan aturan, atur izin — lalu deploy agent ke WhatsApp dalam hitungan menit.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/register" className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-green-700">
              Coba gratis <ArrowRight size={15} weight="bold" />
            </Link>
            <Link href="/login" className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50">
              Masuk dashboard
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ------------------------------- Footer ------------------------------- */

function Footer() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="mx-auto max-w-6xl px-5 py-12 sm:px-8">
        <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-1">
            <Link href="/" className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-600 text-white">
                <ChatCircleDots size={20} weight="fill" />
              </span>
              <span className="font-display text-lg font-extrabold tracking-tight">CSQ</span>
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-slate-500">{SITE_TAGLINE}. Self-host, multi-tenant, data tetap milik Anda.</p>
          </div>
          <FooterCol title="Produk" links={[{ label: "Cara Kerja", href: "#cara-kerja" }, { label: "Fitur", href: "#fitur" }, { label: "Keamanan", href: "#keamanan" }, { label: "FAQ", href: "#faq" }]} />
          <FooterCol title="Mulai" links={[{ label: "Daftar", href: "/register" }, { label: "Masuk", href: "/login" }, { label: "Dashboard", href: "/dashboard" }]} />
          <div>
            <p className="font-mono-data text-xs font-bold uppercase tracking-wider text-slate-900">Prinsip</p>
            <p className="mt-4 text-sm leading-relaxed text-slate-500">Baca secara default.<br />Tulis dengan izin.<br />Bertindak sesuai aturan.</p>
          </div>
        </div>
        <div className="mt-10 flex flex-col items-start justify-between gap-3 border-t border-slate-200 pt-6 text-xs text-slate-400 sm:flex-row sm:items-center">
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
      <p className="font-mono-data text-xs font-bold uppercase tracking-wider text-slate-900">{title}</p>
      <ul className="mt-4 space-y-2.5 text-sm">
        {links.map((l) => (
          <li key={l.label}>
            <Link href={l.href} className="text-slate-600 transition-colors hover:text-slate-900">{l.label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
