// CSQ marketing landing page — public front door at /.
//
// Visual direction (Pipedrive reference): dark green (#022417) + lime (#d4ff00)
// accent, glass panels, floating UI cards, phone mockups, stacked offset cards,
// an org-chart metrics block, testimonials, and a case-study card. Adapted to
// CSQ: the center phone runs the live HeroChat — the safety moment where the
// agent quotes from business data then refuses an unauthorized price change.
//
// Motion: a WebGL aurora shader behind the hero, scroll-coupled parallax on the
// floating cards and dark section, IntersectionObserver scroll-reveals, a
// marquee channels strip, count-up stats, and hover lifts. All disabled under
// prefers-reduced-motion. No heavy dependencies (4GB deploy target).
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/router";
import type { FormEvent } from "react";
import {
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
  Kanban,
  Hand,
  Users,
  Lightning,
  EnvelopeSimple,
} from "@phosphor-icons/react";
import { Seo, SITE_NAME, SITE_TAGLINE, DEFAULT_DESCRIPTION } from "@/components/seo";
import { Reveal } from "@/components/landing/reveal";
import { HeroChat } from "@/components/landing/hero-chat";
import { WebglBg } from "@/components/landing/webgl-bg";
import { useParallax } from "@/components/landing/use-parallax";
import { CountUp } from "@/components/landing/count-up";

const LIME = "#d4ff00";

type Feature = { index: string; title: string; body: string; icon: typeof Robot; highlight?: boolean };

const FEATURES: Feature[] = [
  {
    index: "F-01",
    title: "Agent CSAI di WhatsApp",
    body: "Deploy AI Customer Service di WhatsApp — Cloud API resmi atau nomor Anda sendiri. Inbox bersama tim, handoff ke manusia, dan template pesan untuk luar jendela 24 jam.",
    icon: WhatsappLogo,
    highlight: true,
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

const STEPS_LEFT = [
  { n: "01", title: "Sambungkan data", body: "Impor Excel/CSV, hubungkan Google Sheets, atau input manual. Agent langsung membaca stok, produk, harga, dan kebijakan Anda." },
  { n: "02", title: "Ajarkan agent", body: "Tambahkan FAQ, kebijakan, dan aturan bisnis. Atur persona dan instruksi owner. Agent mengambil yang relevan via pencarian, bukan menghafal." },
  { n: "03", title: "Atur izin", body: "Pilih apa yang boleh dibaca dan diubah per tool. Tentukan aksi yang butuh persetujuan Anda. Default: baca saja." },
];
const STEPS_RIGHT = [
  { n: "04", title: "Deploy ke WhatsApp", body: "Pilih Cloud API resmi atau nomor Anda sendiri via Baileys. Agent mulai melayani pelanggan langsung di WhatsApp." },
  { n: "05", title: "Sajikan pelanggan 24/7", body: "Agent menjawab pertanyaan, cek stok, dan bantu pesanan — sesuai aturan dan izin Anda, kapan saja." },
  { n: "06", title: "Pantau & ambil alih", body: "Inbox bersama: lihat percakapan, tag, tugaskan, dan ambil alih dari AI kapan saja. Approval masuk untuk aksi yang butuh Anda." },
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

const PERMISSIONS = [
  { label: "Membaca produk & stok", state: "Boleh" as const },
  { label: "Mengubah harga", state: "Perlu izin" as const },
  { label: "Membuat pesanan", state: "Boleh" as const },
  { label: "Menghapus data", state: "Diblokir" as const },
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
  const heroLeft = useParallax<HTMLDivElement>(0.18);
  const heroRight = useParallax<HTMLDivElement>(-0.14);
  const darkInner = useParallax<HTMLDivElement>(0.1);

  return (
    <>
      <Seo description={DEFAULT_DESCRIPTION} path="/" jsonLd={jsonLd} />

      <div className="min-h-screen bg-white text-slate-900">
        <Hero leftRef={heroLeft} rightRef={heroRight} />
        <ChannelsStrip />
        <HowItWorks />
        <KeyFeature />
        <TeamSection innerRef={darkInner} />
        <Capabilities />
        <Testimonials />
        <CaseStudy />
        <Faq />
        <CtaBand />
        <Footer />
      </div>
    </>
  );
}

/* --------------------------- Email pill (shared) --------------------------- */

function EmailPill({ onSubmit }: { onSubmit: () => void }) {
  const [email, setEmail] = useState("");
  function submit(e: FormEvent) {
    e.preventDefault();
    onSubmit();
  }
  return (
    <form onSubmit={submit} className="relative flex w-full max-w-md items-center gap-2 rounded-full glass-panel p-1.5 shadow-2xl">
      <EnvelopeSimple size={16} className="ml-3 shrink-0 text-white/50" />
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Masukkan email bisnis Anda"
        className="w-full flex-1 bg-transparent px-1 py-2 text-sm text-white placeholder-white/40 focus:outline-none"
      />
      <button
        type="submit"
        className="absolute right-1.5 inline-flex items-center gap-1.5 rounded-full bg-[#d4ff00] px-4 py-2 text-sm font-bold text-[#022417] transition-colors hover:bg-[#c2eb00]"
      >
        Coba gratis <ArrowRight size={14} weight="bold" />
      </button>
    </form>
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
    <header className={"sticky top-0 z-50 transition-colors " + (scrolled ? "border-b border-white/10 bg-[#022417]/85 backdrop-blur" : "border-b border-transparent bg-transparent")}>
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link href="/" className="flex items-center gap-2 text-white">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#d4ff00] font-display text-lg font-black text-[#022417]">C</span>
          <span className="font-display text-xl font-bold tracking-tight">CSQ</span>
        </Link>
        <div className="hidden items-center gap-7 text-sm text-white/70 md:flex">
          <a href="#cara-kerja" className="hover:text-white">Cara Kerja</a>
          <a href="#fitur" className="hover:text-white">Fitur</a>
          <a href="#tim" className="hover:text-white">Tim &amp; AI</a>
          <a href="#faq" className="hover:text-white">FAQ</a>
        </div>
        <Link href="/register" className="inline-flex items-center gap-1.5 rounded-full bg-[#d4ff00] px-5 py-2 text-sm font-semibold text-[#022417] transition-colors hover:bg-[#c2eb00]">
          Coba gratis <ArrowRight size={14} weight="bold" />
        </Link>
      </nav>
    </header>
  );
}

/* -------------------------------- Hero -------------------------------- */

function Hero({ leftRef, rightRef }: { leftRef: React.RefObject<HTMLDivElement>; rightRef: React.RefObject<HTMLDivElement> }) {
  const router = useRouter();
  return (
    <header className="hero-bg relative overflow-hidden pb-44 text-white">
      <WebglBg className="absolute inset-0 -z-0 h-full w-full" />
      {/* darken overlay for legibility */}
      <div className="absolute inset-0 -z-0 bg-[#022417]/30" />

      <Navbar />

      <div className="relative z-20 mx-auto mt-12 max-w-4xl px-6 text-center">
        <p className="rise-in font-mono-data text-[11px] font-medium uppercase tracking-[0.2em] text-[#d4ff00]">
          Agent Pelayanan Pelanggan · WhatsApp · Self-host
        </p>
        <h1 className="rise-in mt-5 font-display text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-6xl" style={{ animationDelay: "60ms" }}>
          AI yang mengenal bisnis Anda,
          <br className="hidden sm:block" /> melayani pelanggan di WhatsApp.
        </h1>
        <p className="rise-in mx-auto mt-6 max-w-2xl text-sm font-medium text-white/70 sm:text-base" style={{ animationDelay: "140ms" }}>
          CSQ adalah agen AI self-host untuk UMKM Indonesia. Ia membaca stok, harga, dan kebijakan dari data yang sudah Anda punya — menjawab secara default, menulis dengan izin Anda.
        </p>
        <div className="rise-in mt-8 flex justify-center" style={{ animationDelay: "220ms" }}>
          <EmailPill onSubmit={() => router.push("/register")} />
        </div>
      </div>

      {/* Floating UI cluster */}
      <div className="relative z-10 mx-auto mt-14 flex h-72 max-w-5xl items-center justify-center px-6 md:h-80">
        {/* Left floating card — stock & price (read) */}
        <div ref={leftRef} className="parallax-y hidden md:block">
          <div className="float-soft w-56 -rotate-2 rounded-2xl glass-panel p-4 shadow-2xl transition-transform duration-500 hover:rotate-0">
            <div className="mb-3 flex items-center justify-between">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#d4ff00]/20 text-[#d4ff00]">
                <Database size={16} />
              </span>
              <span className="rounded-full border border-white/15 px-2 py-0.5 text-[10px] text-white/50">Stok</span>
            </div>
            <p className="mb-1 text-xs text-white/50">Kopi Arabika 250g</p>
            <p className="mb-2 text-lg font-bold text-white">Rp85.000</p>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-3/4 rounded-full bg-[#d4ff00]" />
            </div>
            <p className="mt-1.5 text-[10px] text-white/40">12 pack tersedia</p>
          </div>
        </div>

        {/* Center phone — live app (HeroChat) */}
        <div className="absolute bottom-[-110px] z-20 flex h-[440px] w-64 flex-col overflow-hidden rounded-[2.5rem] border-[6px] border-gray-800 bg-gray-900 p-3 shadow-2xl md:bottom-[-150px] md:w-72">
          <div className="absolute left-1/2 top-0 z-30 h-5 w-24 -translate-x-1/2 rounded-b-xl bg-gray-800" />
          <div className="mt-4 h-full overflow-hidden rounded-[2rem] bg-white">
            <HeroChat bare />
          </div>
        </div>

        {/* Right floating card — approval (write by permission) */}
        <div ref={rightRef} className="parallax-y hidden md:block">
          <div className="float-soft-2 w-56 rotate-2 rounded-2xl glass-panel p-4 shadow-2xl transition-transform duration-500 hover:rotate-0">
            <div className="mb-3 flex items-center gap-3 border-b border-white/10 pb-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e2b50a]/20 text-[#e2b50a]">
                <ShieldCheck size={16} weight="fill" />
              </span>
              <div>
                <p className="text-xs font-bold text-white">Permintaan diskon</p>
                <p className="text-[10px] text-[#e2b50a]">Menunggu persetujuan owner</p>
              </div>
            </div>
            <div className="flex items-end justify-between">
              <div>
                <p className="mb-0.5 text-[10px] text-white/40">Permintaan</p>
                <p className="text-sm font-bold text-white">Rp50.000 × 5</p>
              </div>
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#d4ff00] text-[#022417]">
                <Check size={12} weight="bold" />
              </span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

/* --------------------------- Channels strip --------------------------- */

function ChannelsStrip() {
  return (
    <section className="border-b border-slate-100 bg-white pb-16 pt-32 text-center">
      <p className="mb-8 text-sm font-bold tracking-wide text-slate-900">Terhubung ke saluran &amp; data yang sudah Anda pakai</p>
      <div className="flex flex-wrap items-center justify-center gap-8 px-6 md:gap-14">
        {CHANNELS.map((c) => (
          <div key={c.label} className="flex items-center gap-1.5 text-lg font-bold text-slate-400 opacity-70 grayscale transition duration-500 hover:text-slate-900 hover:opacity-100 hover:grayscale-0">
            <c.icon size={22} /> {c.label}
          </div>
        ))}
      </div>
    </section>
  );
}

/* ----------------------------- How it works ----------------------------- */

function HowItWorks() {
  return (
    <section id="cara-kerja" className="bg-[#f7f9f8] py-24">
      <div className="mx-auto max-w-7xl px-6">
        <Reveal>
          <div className="mx-auto mb-16 max-w-2xl text-center">
            <span className="mb-3 inline-block rounded-full bg-[#d4ff00]/20 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-green-800">Cara kerja</span>
            <h2 className="font-display text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">Dari data ke AI yang melayani</h2>
            <p className="mt-4 text-sm text-slate-500">Hubungkan data, ajarkan aturan, atur izin — lalu deploy agent ke WhatsApp dalam hitungan menit.</p>
          </div>
        </Reveal>

        <div className="grid grid-cols-1 items-center gap-10 lg:grid-cols-3">
          <Reveal>
            <div className="space-y-6">
              {STEPS_LEFT.map((s) => (
                <StepCard key={s.n} step={s} />
              ))}
            </div>
          </Reveal>

          {/* Center phone — pipeline mockup */}
          <Reveal delay={120}>
            <div className="flex justify-center">
              <div className="relative h-[420px] w-64 rounded-[2.5rem] bg-[#d4ff00] p-2 shadow-2xl">
                <div className="flex h-full flex-col overflow-hidden rounded-[2rem] border-4 border-white bg-white pt-6">
                  <div className="mx-auto mb-4 h-1 w-16 rounded-full bg-gray-300" />
                  <div className="flex items-center justify-between border-b border-gray-100 px-4 pb-3">
                    <span className="text-sm font-bold text-gray-900">Pipeline</span>
                    <Kanban size={16} className="text-gray-500" />
                  </div>
                  <div className="flex-1 space-y-3 overflow-y-auto bg-gray-50 p-3">
                    <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-500">Qualified (3)</p>
                      <div className="relative mb-2 overflow-hidden rounded-lg border border-[#d4ff00] p-2">
                        <div className="absolute bottom-0 left-0 top-0 w-1 bg-[#d4ff00]" />
                        <p className="text-xs font-bold text-gray-900">Toko Makmur</p>
                        <p className="text-[10px] text-gray-500">Rp1.200.000</p>
                      </div>
                      <div className="rounded-lg border border-gray-100 p-2">
                        <p className="text-xs font-bold text-gray-900">Dewi Catering</p>
                        <p className="text-[10px] text-gray-500">Rp680.000</p>
                      </div>
                    </div>
                    <div className="rounded-xl border border-gray-100 bg-white p-3 shadow-sm">
                      <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-500">Deal Won (1)</p>
                      <div className="rounded-lg border border-gray-100 p-2">
                        <p className="text-xs font-bold text-gray-900">Warung Bu Tini</p>
                        <p className="text-[10px] text-green-600">Selesai</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Reveal>

          <Reveal delay={60}>
            <div className="space-y-6">
              {STEPS_RIGHT.map((s) => (
                <StepCard key={s.n} step={s} />
              ))}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function StepCard({ step }: { step: { n: string; title: string; body: string } }) {
  return (
    <div className="flex items-start gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-[#d4ff00]">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#d4ff00]/20 font-mono-data text-xs font-bold text-green-800">{step.n}</span>
      <div>
        <h3 className="mb-1 text-sm font-bold text-slate-900">{step.title}</h3>
        <p className="text-xs leading-relaxed text-slate-500">{step.body}</p>
      </div>
    </div>
  );
}

/* ----------------------------- Key feature ----------------------------- */

function KeyFeature() {
  return (
    <section className="overflow-hidden bg-white py-24">
      <div className="mx-auto grid max-w-7xl grid-cols-1 items-center gap-16 px-6 lg:grid-cols-2">
        {/* Offset stacked cards */}
        <Reveal>
          <div className="relative h-[400px]">
            <div className="absolute left-0 top-12 w-4/5 -rotate-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-lg">
              <div className="mb-4 flex items-center justify-between border-b border-slate-100 pb-2">
                <span className="text-xs font-bold uppercase text-slate-500">Audit stream</span>
                <ListChecks size={16} className="text-slate-300" />
              </div>
              <div className="space-y-3 opacity-60">
                {["agent.read product", "agent.read inventory", "owner.approve discount", "agent.create order"].map((t) => (
                  <div key={t} className="flex items-center gap-3">
                    <span className="h-2 w-2 rounded-full bg-green-500" />
                    <span className="font-mono-data text-[11px] text-slate-500">{t}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="absolute right-0 top-0 z-10 w-4/5 rounded-2xl border-2 border-[#d4ff00] bg-white p-6 shadow-2xl lg:right-4">
              <div className="mb-6 flex items-center justify-between">
                <h4 className="text-sm font-bold text-slate-900">Izin per-aksi</h4>
                <span className="rounded bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">Kontrol owner</span>
              </div>
              <div className="space-y-4">
                {PERMISSIONS.map((p) => (
                  <div key={p.label}>
                    <div className="mb-1.5 flex items-center justify-between text-xs">
                      <span className="font-semibold text-slate-700">{p.label}</span>
                      <span className="font-mono-data text-[10px] font-bold text-slate-900">{p.state}</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: p.state === "Boleh" ? "100%" : p.state === "Perlu izin" ? "50%" : "12%",
                          backgroundColor: p.state === "Boleh" ? "#16a34a" : p.state === "Perlu izin" ? "#e2b50a" : "#cbd5e1",
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Reveal>

        {/* Copy + checklist */}
        <Reveal delay={120}>
          <div>
            <span className="mb-3 inline-block rounded-full bg-[#d4ff00]/20 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-green-800">Prinsip inti</span>
            <h2 className="font-display text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">Baca secara default. Tulis dengan izin.</h2>
            <p className="mt-5 mb-8 text-sm leading-relaxed text-slate-500">
              Agent dirancang untuk membaca dan menjawab. Setiap aksi yang mengubah data adalah izin terpisah, dan sebagian butuh persetujuan Anda. Anda yang memegang kendali, agent yang bekerja.
            </p>
            <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {["Izin per-tool", "Approval owner", "Audit sebelum/sesudah", "Ambil alih kapan saja"].map((t) => (
                <div key={t} className="flex items-center gap-2 text-sm font-semibold text-slate-800">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#d4ff00] text-[#022417]">
                    <Check size={11} weight="bold" />
                  </span>
                  {t}
                </div>
              ))}
            </div>
            <Link href="/register" className="inline-flex items-center gap-2 rounded-full bg-[#d4ff00] px-6 py-3 text-sm font-bold text-[#022417] shadow-sm transition hover:bg-[#c2eb00]">
              Mulai gratis <ArrowRight size={15} weight="bold" />
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* --------------------------- Team & AI section --------------------------- */

function TeamSection({ innerRef }: { innerRef: React.RefObject<HTMLDivElement> }) {
  return (
    <section id="tim" className="dark-section-bg relative overflow-hidden py-24 text-white">
      <div className="mx-auto max-w-5xl px-6 text-center">
        <Reveal>
          <span className="mb-4 inline-block rounded-full border border-[#d4ff00]/30 bg-white/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-[#d4ff00]">Tim &amp; AI</span>
          <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">Tim manusia dan AI, satu inbox.</h2>
          <p className="mx-auto mt-4 max-w-2xl text-sm text-white/60">
            Owner dan staff bekerja berdampingan dengan agent di inbox bersama. Tugaskan, beri tag, ambil alih — agent berdiri sementara Anda menangani, lalu kembali saat dilepas.
          </p>
        </Reveal>

        {/* Org / metrics layout */}
        <div ref={innerRef} className="parallax-y relative mx-auto mt-14 flex max-w-3xl flex-col items-center">
          {/* Owner node */}
          <Reveal>
            <div className="flex min-w-[200px] items-center gap-4 rounded-2xl border border-white/10 bg-[#03301f] p-3 shadow-xl">
              <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#d4ff00] bg-[#d4ff00]/10 text-[#d4ff00]">
                <Users size={18} weight="fill" />
              </span>
              <div className="text-left">
                <p className="text-xs font-bold">Owner</p>
                <p className="text-[10px] text-white/50">Kontrol penuh &amp; approval</p>
              </div>
            </div>
          </Reveal>

          <div className="h-8 w-px bg-[#d4ff00]/50" />

          {/* Central metrics */}
          <Reveal delay={120}>
            <div className="w-full max-w-lg rounded-3xl border border-[#d4ff00]/30 bg-white p-6 text-slate-900 shadow-2xl sm:p-8">
              <h3 className="mb-6 text-xs font-bold uppercase tracking-wider text-slate-400">Performa minggu ini</h3>
              <div className="mb-6 text-4xl font-extrabold text-[#022417]">
                <CountUp value={1240} /> <span className="align-middle ml-2 rounded bg-green-50 px-2 py-1 text-sm font-bold text-green-600">+18%</span>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <Metric icon={Robot} value={92} suffix="%" label="Ditangani AI" />
                <Metric icon={ShieldCheck} value={14} label="Approval" />
                <Metric icon={Lightning} value={3.2} decimals={1} suffix="m" label="Rerata respon" />
              </div>
            </div>
          </Reveal>

          <div className="h-8 w-px bg-[#d4ff00]/50" />
          <div className="relative h-px w-full max-w-md bg-[#d4ff00]/50">
            <div className="absolute left-0 top-0 h-8 w-px bg-[#d4ff00]/50" />
            <div className="absolute right-0 top-0 h-8 w-px bg-[#d4ff00]/50" />
          </div>

          {/* Bottom nodes */}
          <Reveal delay={60}>
            <div className="mt-8 flex w-full max-w-[500px] justify-between gap-4">
              <div className="flex min-w-[160px] items-center gap-3 rounded-xl border border-white/10 bg-[#03301f] p-2.5 shadow-lg">
                <span className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 text-white/70"><Hand size={15} /></span>
                <div className="text-left">
                  <p className="text-[11px] font-bold">Staff</p>
                  <p className="text-[9px] text-white/50">Inbox bersama</p>
                </div>
              </div>
              <div className="flex min-w-[160px] items-center gap-3 rounded-xl border border-white/10 bg-[#03301f] p-2.5 shadow-lg">
                <span className="flex h-8 w-8 items-center justify-center rounded-full border border-[#d4ff00]/40 text-[#d4ff00]"><Robot size={15} weight="fill" /></span>
                <div className="text-left">
                  <p className="text-[11px] font-bold">CS Agent AI</p>
                  <p className="text-[9px] text-white/50">WhatsApp 24/7</p>
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

function Metric({ icon: Icon, value, decimals = 0, suffix = "", label }: { icon: typeof Robot; value: number; decimals?: number; suffix?: string; label: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-[#f7f9f8] p-4">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#d4ff00]/20 text-green-800">
        <Icon size={18} />
      </span>
      <div className="text-left">
        <p className="text-lg font-bold text-slate-900">
          <CountUp value={value} decimals={decimals} suffix={suffix} />
        </p>
        <p className="text-[10px] font-semibold text-slate-500">{label}</p>
      </div>
    </div>
  );
}

/* ----------------------------- Capabilities ----------------------------- */

function Capabilities() {
  return (
    <section id="fitur" className="bg-[#f7f9f8] py-24">
      <div className="mx-auto max-w-7xl px-6">
        <Reveal>
          <div className="mx-auto mb-16 max-w-2xl text-center">
            <span className="mb-3 inline-block rounded-full bg-[#d4ff00]/20 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-green-800">Kapabilitas</span>
            <h2 className="font-display text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">Semua yang agent butuh, Anda kendalikan</h2>
            <p className="mt-4 text-sm text-slate-500">Satu platform untuk membaca data bisnis, melayani pelanggan, dan mengontrol setiap aksi agent.</p>
          </div>
        </Reveal>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f, i) => (
            <Reveal key={f.index} delay={i * 50}>
              <div
                className={
                  "rounded-2xl bg-white p-6 shadow-sm transition duration-300 hover:-translate-y-1 " +
                  (f.highlight ? "border-2 border-[#d4ff00] shadow-md" : "border border-slate-200 hover:border-[#d4ff00]")
                }
              >
                <span className={"mb-4 flex h-10 w-10 items-center justify-center rounded-xl " + (f.highlight ? "bg-[#d4ff00]/20 text-green-800" : "bg-green-50 text-green-700")}>
                  <f.icon size={20} />
                </span>
                <h3 className="mb-2 font-bold text-slate-900">{f.title}</h3>
                <p className="text-xs leading-relaxed text-slate-500">{f.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ----------------------------- Testimonials ----------------------------- */

const REVIEWS = [
  { name: "Rina W.", role: "Owner, Toko Kopi Nusantara", img: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80", quote: "Agent menjawab pertanyaan pelanggan tentang stok dan harga bahkan tengah malam. Saya cuma ambil alih kalau ada diskon besar." },
  { name: "Budi S.", role: "Owner, Warung Bu Tini", img: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=150&auto=format&fit=crop&q=80", quote: "Saya suka bahwa agent tidak bisa sembarangan ubah harga. Semua aksi tertulis, jadi saya tahu persis apa yang terjadi." },
  { name: "Sari D.", role: "Owner, Dewi Catering", img: "https://images.unsplash.com/photo-1438761681033-6461ffad8d80?w=150&auto=format&fit=crop&q=80", quote: "Data saya tetap di Excel seperti biasa. Agent baca dari sana. Tidak perlu pindah format atau ribet." },
  { name: "Andi P.", role: "Owner, Toko Makmur", img: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80", quote: "Inbox bersama bikin saya dan staff sejalan dengan AI. Tag dan tugaskan jadi gampang, handoff cepat." },
];

function Testimonials() {
  return (
    <section className="bg-white py-24">
      <div className="mx-auto max-w-6xl px-6">
        <Reveal>
          <div className="mx-auto mb-16 max-w-2xl text-center">
            <span className="mb-3 inline-block rounded-full bg-[#d4ff00]/20 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-green-800">Testimoni</span>
            <h2 className="font-display text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">Apa kata pemilik UMKM</h2>
            <p className="mt-4 text-sm text-slate-500">Ribuan pemilik usaha memakai AI untuk melayani pelanggan tanpa kehilangan kendali.</p>
          </div>
        </Reveal>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {REVIEWS.map((r, i) => (
            <Reveal key={r.name} delay={i * 60}>
              <figure className="flex gap-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:shadow-md">
                <Image src={r.img} alt={r.name} width={80} height={96} className="h-24 w-20 flex-shrink-0 rounded-xl object-cover" unoptimized />
                <figcaption className="flex flex-col justify-between">
                  <blockquote className="mb-3 text-xs italic font-medium leading-relaxed text-slate-600">“{r.quote}”</blockquote>
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-[11px] font-bold text-slate-900">{r.name}</p>
                      <p className="text-[9px] text-slate-500">{r.role}</p>
                    </div>
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#d4ff00] text-[#022417]">
                      <Sparkle size={12} weight="fill" />
                    </span>
                  </div>
                </figcaption>
              </figure>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------ Case study ------------------------------ */

function CaseStudy() {
  return (
    <section className="bg-white py-16">
      <div className="mx-auto max-w-5xl px-6">
        <h3 className="mb-6 text-center font-display text-xl font-extrabold">Studi kasus UMKM</h3>
        <div className="mb-8 flex flex-wrap justify-center gap-3">
          <span className="rounded-full bg-[#d4ff00] px-5 py-2 text-xs font-bold text-[#022417] shadow-sm">Toko Kopi Nusantara</span>
          {["Warung Bu Tini", "Dewi Catering", "Toko Makmur"].map((t) => (
            <span key={t} className="rounded-full border border-slate-200 bg-white px-5 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50">{t}</span>
          ))}
        </div>

        <Reveal>
          <div className="flex flex-col items-center gap-8 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:flex-row md:p-8">
            <Image src="https://images.unsplash.com/photo-1447933601403-2c2109a4b9a2?w=600&auto=format&fit=crop&q=80" alt="Kedai kopi" width={600} height={192} className="h-48 w-full rounded-2xl object-cover shadow-sm md:w-2/5" unoptimized />
            <div className="md:w-3/5">
              <p className="mb-6 text-sm italic font-medium leading-relaxed text-slate-700">
                “Sebelum CSQ, pesanan masuk tengah malam sering terlewat. Sekarang agent menjawab dan bantu catat pesanan dari data stok saya sendiri. Waktu respon turun drastis, pelanggan lebih puas.”
              </p>
              <div className="mb-6 flex items-center gap-4 border-b border-slate-100 pb-6">
                <Image src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=100&auto=format&fit=crop&q=80" alt="Rina W." width={40} height={40} className="h-10 w-10 rounded-full object-cover" unoptimized />
                <div>
                  <p className="text-xs font-bold text-slate-900">Rina Wulandari</p>
                  <p className="text-[10px] text-slate-500">Owner, Toko Kopi Nusantara</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <Stat value={140} prefix="+" suffix="%" label="Kecepatan respon" />
                <Stat value={3.5} decimals={1} suffix="×" label="Kapasitas layani" />
                <Stat value={99.8} decimals={1} suffix="%" label="Uptime agent" />
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

function Stat({ value, decimals = 0, prefix = "", suffix = "", label }: { value: number; decimals?: number; prefix?: string; suffix?: string; label: string }) {
  return (
    <div>
      <p className="mb-1 font-display text-xl font-extrabold text-[#022417]">
        <CountUp value={value} decimals={decimals} prefix={prefix} suffix={suffix} />
      </p>
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{label}</p>
    </div>
  );
}

/* -------------------------------- FAQ -------------------------------- */

function Faq() {
  return (
    <section id="faq" className="mx-auto max-w-3xl px-6 py-20">
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

/* ------------------------------- CTA band ------------------------------- */

function CtaBand() {
  const router = useRouter();
  return (
    <section className="bg-white py-16">
      <div className="mx-auto max-w-5xl px-6">
        <div className="hero-bg relative overflow-hidden rounded-[2.5rem] border border-[#d4ff00]/20 p-12 text-center text-white shadow-2xl">
          <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">Siap membuat AI bekerja untuk usaha Anda?</h2>
          <p className="mx-auto mt-4 mb-10 max-w-lg text-sm text-white/70">Mulai gratis. Hubungkan data, ajarkan aturan, deploy ke WhatsApp dalam hitungan menit.</p>
          <div className="flex justify-center">
            <EmailPill onSubmit={() => router.push("/register")} />
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------- Footer ------------------------------- */

function Footer() {
  return (
    <footer className="border-t border-slate-100 bg-white pb-8 pt-16 text-sm">
      <div className="mx-auto mb-12 grid max-w-7xl grid-cols-2 gap-8 px-6 md:grid-cols-5">
        <div className="col-span-2 md:col-span-2">
          <Link href="/" className="mb-4 flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#022417] font-display text-lg font-black text-[#d4ff00]">C</span>
            <span className="font-display text-xl font-bold tracking-tight text-slate-900">CSQ</span>
          </Link>
          <p className="mb-6 max-w-xs text-xs leading-relaxed text-slate-500">{SITE_TAGLINE}. Self-host, multi-tenant, data tetap milik Anda.</p>
        </div>
        <FooterCol title="Produk" links={[{ label: "Cara Kerja", href: "#cara-kerja" }, { label: "Fitur", href: "#fitur" }, { label: "Tim & AI", href: "#tim" }, { label: "FAQ", href: "#faq" }]} />
        <FooterCol title="Mulai" links={[{ label: "Daftar", href: "/register" }, { label: "Masuk", href: "/login" }, { label: "Dashboard", href: "/dashboard" }]} />
        <div>
          <p className="mb-4 font-mono-data text-xs font-bold uppercase tracking-wider text-slate-900">Prinsip</p>
          <p className="text-xs leading-relaxed text-slate-500">Baca secara default.<br />Tulis dengan izin.<br />Bertindak sesuai aturan.</p>
        </div>
      </div>
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 border-t border-slate-100 px-6 pt-6 text-[11px] text-slate-400 sm:flex-row">
        <p>© {new Date().getFullYear()} {SITE_NAME}. Dibuat untuk UMKM Indonesia.</p>
        <p className="font-mono-data uppercase tracking-wider">Self-hosted · Docker Compose</p>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <p className="mb-4 font-mono-data text-xs font-bold uppercase tracking-wider text-slate-900">{title}</p>
      <ul className="space-y-3 text-xs text-slate-500">
        {links.map((l) => (
          <li key={l.label}>
            <Link href={l.href} className="transition hover:text-slate-900">{l.label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
