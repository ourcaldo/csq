// CSQ marketing landing page, public front door at /.
//
// Design read: B2B SaaS landing for Indonesian UMKM + tech audience, premium
// editorial-grotesk language. Plus Jakarta Sans display, Inter body, JetBrains
// Mono labels. One locked accent (green-700). One deliberate dark color-block
// section (the principle). Real photography (picsum placeholders until real
// screenshots are supplied), double-bezel cards, asymmetric bento, fluid
// IntersectionObserver fade-up+blur reveals. No div-based fake UI, no icon-in-
// rounded-square chips, no em-dashes, eyebrows rationed to ~1 per 3 sections.
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Check, Plus, Minus, ArrowRight } from "@phosphor-icons/react";
import { Seo, SITE_NAME, SITE_TAGLINE, DEFAULT_DESCRIPTION } from "@/components/seo";
import { Reveal } from "@/components/landing/reveal";

const STEPS = [
  {
    n: "01",
    title: "Sambungkan data",
    body: "Impor Excel atau CSV, hubungkan Google Sheets, atau input manual. Agent membaca stok, produk, harga, dan kebijakan dari sumber yang sudah Anda pakai.",
  },
  {
    n: "02",
    title: "Atur izin dan ajarkan",
    body: "Pilih apa yang boleh dibaca dan diubah per tool. Tambahkan FAQ dan aturan. Aksi sensitif butuh persetujuan Anda. Default: baca saja.",
  },
  {
    n: "03",
    title: "Deploy ke WhatsApp",
    body: "Pilih Cloud API resmi atau nomor Anda sendiri. Agent melayani pelanggan, sementara Anda memantau dan mengambil alih dari inbox bersama kapan saja.",
  },
];

const FEATURES = [
  {
    cell: "a" as const,
    title: "Inbox bersama: tim dan AI satu layar",
    body: "Owner dan staff bekerja berdampingan dengan agent di inbox CRM. Beri tag, tugaskan, dan ambil alih dari AI. Agent berdiri sementara, lalu kembali saat dilepas.",
    image: "https://picsum.photos/seed/csq-inbox-customer-service/900/680",
  },
  {
    cell: "b" as const,
    title: "Membaca data yang sudah Anda punya",
    body: "Excel, CSV, Google Sheets, input manual, dan dokumen dinormalisasi lewat Business Context Layer. Agent membacanya seperti staf Anda.",
  },
  {
    cell: "c" as const,
    title: "Izin per-aksi",
    body: "Membaca secara default. Menulis adalah izin terpisah per tool, dan aksi sensitif butuh persetujuan owner.",
  },
  {
    cell: "d" as const,
    title: "Audit penuh",
    body: "Setiap aksi tercatat dengan status persetujuan. Anda tahu persis apa yang dibaca agent dan apa yang diubah.",
  },
];

const PRINCIPLE_POINTS = [
  "Izin per-tool",
  "Approval owner",
  "Audit sebelum dan sesudah",
  "Ambil alih kapan saja",
];

const FAQS: { q: string; a: string }[] = [
  { q: "Apakah saya butuh coding?", a: "Tidak. CSQ dirancang untuk owner UMKM. Hubungkan data, ajarkan aturan, dan atur izin lewat dashboard, tanpa kode." },
  { q: "Apakah datanya aman?", a: "CSQ self-host: deploy di server Anda sendiri dengan Docker Compose. Data bisnis dan pelanggan tetap di kendali Anda, terisolasi per tenant." },
  { q: "Bisa pakai nomor WhatsApp saya sendiri?", a: "Bisa. Pilih Cloud API resmi Meta atau Baileys dengan nomor Anda sendiri via QR. Owner memilih saat onboarding, keduanya tersedia." },
  { q: "Bagaimana kalau AI salah jawab atau berbuat di luar batas?", a: "Agent baca secara default dan hanya menulis dengan izin per tool. Aksi sensitif butuh persetujuan owner. Setiap aksi tercatat untuk audit, dan Anda bisa ambil alih kapan saja." },
  { q: "Berapa harganya?", a: "CSQ open untuk dihosting sendiri. Anda hanya menanggung server, VPS kecil sudah cukup, dan biaya WhatsApp Cloud API sesuai pemakaian." },
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
      <div className="min-h-screen bg-[#FAFAF8] text-[#141A17]">
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

/* ------------------------------- Primitives ------------------------------- */

function PrimaryButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="group group-cta inline-flex items-center gap-2.5 rounded-full bg-green-700 px-6 py-3.5 text-sm font-semibold text-white shadow-[0_14px_34px_-14px_rgba(21,128,61,0.55)] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-green-800 active:scale-[0.98]"
    >
      {children}
      <span className="cta-arrow flex h-7 w-7 items-center justify-center rounded-full bg-white/15">
        <ArrowRight size={14} weight="bold" />
      </span>
    </Link>
  );
}

function GhostButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-2 rounded-full border border-[#141A17]/15 px-6 py-3.5 text-sm font-semibold text-[#141A17] transition-all duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-[#141A17]/[0.04] active:scale-[0.98]"
    >
      {children}
    </Link>
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
          <a href="#keamanan" className="hover:text-[#141A17]">Keamanan</a>
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

function Hero() {
  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-20 sm:px-8 lg:grid-cols-2 lg:gap-14 lg:pb-28 lg:pt-24">
        <div className="max-w-xl">
          <h1 className="rise-in font-display text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl lg:text-[3.4rem]">
            Agen AI yang{" "}
            <span className="text-green-700">mengenal data bisnis Anda</span>,
            melayani pelanggan di WhatsApp.
          </h1>
          <p className="rise-in mt-6 max-w-[34rem] text-base leading-relaxed text-[#141A17]/65 sm:text-lg" style={{ animationDelay: "90ms" }}>
            CSQ membaca stok, harga, dan kebijakan dari data yang sudah Anda
            punya. Membaca secara default, menulis dengan izin Anda.
          </p>
          <div className="rise-in mt-8 flex flex-wrap items-center gap-3" style={{ animationDelay: "170ms" }}>
            <PrimaryButton href="/register">Coba gratis</PrimaryButton>
            <GhostButton href="#cara-kerja">Pelajari cara kerja</GhostButton>
          </div>
        </div>

        {/* Real editorial visual in a double-bezel frame. Placeholder photo
            until a real product screenshot is supplied. */}
        <div className="rise-in lg:pl-6" style={{ animationDelay: "120ms" }}>
          <div className="rounded-[2rem] bg-[#141A17]/[0.04] p-1.5 ring-1 ring-[#141A17]/[0.06]">
            <div className="overflow-hidden rounded-[1.65rem] bg-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.85),0_40px_90px_-50px_rgba(20,26,23,0.35)]">
              {/* TODO: replace placeholder with a real CSQ inbox screenshot, 1200x1400. */}
              <Image
                src="https://picsum.photos/seed/csq-customer-service-whatsapp/1200/1400"
                alt="CSQ inbox percakapan pelanggan di WhatsApp"
                width={1200}
                height={1400}
                priority
                unoptimized
                className="h-auto w-full"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------ Channels ------------------------------ */

function Channels() {
  return (
    <section className="border-y border-[#141A17]/[0.07] bg-white/50 py-7">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-5 gap-y-2 px-5 text-center sm:px-8">
        <span className="text-xs font-medium uppercase tracking-[0.14em] text-[#141A17]/40">Terhubung ke</span>
        {["WhatsApp", "Google Sheets", "Excel / CSV", "PDF", "Input manual"].map((c) => (
          <span key={c} className="text-sm font-medium text-[#141A17]/55">{c}</span>
        ))}
      </div>
    </section>
  );
}

/* ---------------------------- How it works ---------------------------- */

function HowItWorks() {
  return (
    <section id="cara-kerja" className="mx-auto max-w-6xl px-5 py-24 sm:px-8 lg:py-32">
      <Reveal>
        <p className="font-mono-data text-[11px] font-medium uppercase tracking-[0.18em] text-green-700">Cara kerja</p>
        <h2 className="mt-4 max-w-2xl font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
          Dari data ke AI yang melayani, dalam tiga langkah.
        </h2>
      </Reveal>

      <div className="mt-14 divide-y divide-[#141A17]/[0.08] border-t border-[#141A17]/[0.08]">
        {STEPS.map((s, i) => (
          <Reveal key={s.n} delay={i * 80}>
            <div className="grid gap-5 py-8 md:grid-cols-[auto_1fr] md:gap-10 md:py-10">
              <p className="font-display text-4xl font-extrabold tracking-tight text-green-700/30">{s.n}</p>
              <div className="max-w-xl">
                <h3 className="font-display text-xl font-bold tracking-tight">{s.title}</h3>
                <p className="mt-2.5 text-base leading-relaxed text-[#141A17]/65">{s.body}</p>
              </div>
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
    <section id="fitur" className="bg-[#141A17]/[0.025] py-24 lg:py-32">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal>
          <p className="font-mono-data text-[11px] font-medium uppercase tracking-[0.18em] text-green-700">Fitur</p>
          <h2 className="mt-4 max-w-2xl font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
            Yang agent butuh untuk melayani, Anda butuh untuk mengontrol.
          </h2>
        </Reveal>

        <div className="mt-14 grid auto-rows-[minmax(0,1fr)] gap-4 lg:grid-cols-3">
          {/* Cell A: big, with real image */}
          <Reveal className="lg:col-span-2 lg:row-span-2">
            <div className="h-full rounded-[2rem] bg-[#141A17]/[0.04] p-1.5 ring-1 ring-[#141A17]/[0.06]">
              <div className="flex h-full flex-col overflow-hidden rounded-[1.65rem] bg-white shadow-[inset_0_1px_1px_rgba(255,255,255,0.85),0_30px_80px_-40px_rgba(20,26,23,0.28)]">
                <div className="p-7">
                  <h3 className="font-display text-2xl font-bold tracking-tight">{FEATURES[0].title}</h3>
                  <p className="mt-3 max-w-md text-base leading-relaxed text-[#141A17]/65">{FEATURES[0].body}</p>
                </div>
                <div className="mt-auto px-3 pb-3">
                  {/* TODO: replace placeholder with a real CSQ inbox screenshot, 900x680. */}
                  <Image
                    src={FEATURES[0].image ?? ""}
                    alt="Inbox bersama CSQ dengan tim dan AI"
                    width={900}
                    height={680}
                    unoptimized
                    className="h-auto w-full rounded-[1.2rem]"
                  />
                </div>
              </div>
            </div>
          </Reveal>

          {/* Cell B: tinted */}
          <Reveal delay={60}>
            <div className="h-full rounded-[2rem] bg-green-700/[0.07] p-1.5 ring-1 ring-green-700/15">
              <div className="flex h-full flex-col rounded-[1.65rem] bg-green-50/40 p-7">
                <h3 className="font-display text-xl font-bold tracking-tight">{FEATURES[1].title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-[#141A17]/70">{FEATURES[1].body}</p>
              </div>
            </div>
          </Reveal>

          {/* Cell C */}
          <Reveal delay={120}>
            <div className="h-full rounded-[2rem] bg-[#141A17]/[0.04] p-1.5 ring-1 ring-[#141A17]/[0.06]">
              <div className="flex h-full flex-col rounded-[1.65rem] bg-white p-7 shadow-[inset_0_1px_1px_rgba(255,255,255,0.85),0_30px_80px_-40px_rgba(20,26,23,0.28)]">
                <h3 className="font-display text-xl font-bold tracking-tight">{FEATURES[2].title}</h3>
                <p className="mt-3 text-sm leading-relaxed text-[#141A17]/70">{FEATURES[2].body}</p>
                <ul className="mt-4 space-y-2 text-xs text-[#141A17]/60">
                  {["Baca default", "Tulis per tool", "Approval owner"].map((p) => (
                    <li key={p} className="flex items-center gap-2">
                      <Check size={13} weight="bold" className="text-green-700" /> {p}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </Reveal>

          {/* Cell D: full-width */}
          <Reveal className="lg:col-span-3" delay={60}>
            <div className="rounded-[2rem] bg-[#141A17]/[0.04] p-1.5 ring-1 ring-[#141A17]/[0.06]">
              <div className="flex flex-col gap-6 rounded-[1.65rem] bg-white p-7 shadow-[inset_0_1px_1px_rgba(255,255,255,0.85),0_30px_80px_-40px_rgba(20,26,23,0.28)] md:flex-row md:items-center md:justify-between">
                <div className="max-w-xl">
                  <h3 className="font-display text-xl font-bold tracking-tight">{FEATURES[3].title}</h3>
                  <p className="mt-3 text-sm leading-relaxed text-[#141A17]/65">{FEATURES[3].body}</p>
                </div>
                <pre className="overflow-x-auto rounded-xl bg-[#0B1F14] p-4 font-mono-data text-[11px] leading-relaxed text-[#B9E3C6]">
                  {"09:01  read    product  kopi-arabika\n09:01  read    inventory stok=12\n09:02  permit  product.update  DENIED\n09:02  act     request approval (owner)\n09:02  record  audit#042 written"}
                </pre>
              </div>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ----------------------------- Principle ----------------------------- */

function Principle() {
  return (
    <section id="keamanan" className="bg-[#0B1F14] py-24 text-[#EDEFEA] lg:py-36">
      <div className="mx-auto max-w-4xl px-5 text-center sm:px-8">
        <Reveal>
          <h2 className="font-display text-4xl font-extrabold leading-[1.1] tracking-tight sm:text-5xl lg:text-6xl">
            Baca secara default.<br /> Tulis dengan izin.<br />{" "}
            <span className="text-green-400">Bertindak sesuai aturan.</span>
          </h2>
          <p className="mx-auto mt-8 max-w-2xl text-base leading-relaxed text-[#EDEFEA]/70">
            Agent dirancang untuk membaca dan menjawab. Setiap aksi yang
            mengubah data adalah izin terpisah, dan sebagian butuh persetujuan
            Anda. Anda yang memegang kendali, agent yang bekerja.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-sm text-[#EDEFEA]/85">
            {PRINCIPLE_POINTS.map((p) => (
              <span key={p} className="inline-flex items-center gap-2">
                <Check size={15} weight="bold" className="text-green-400" /> {p}
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
    <section id="faq" className="mx-auto max-w-3xl px-5 py-24 sm:px-8 lg:py-32">
      <Reveal>
        <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">Pertanyaan yang sering muncul.</h2>
      </Reveal>
      <div className="mt-10 divide-y divide-[#141A17]/[0.1] border-t border-[#141A17]/[0.1]">
        {FAQS.map((f, i) => (
          <Reveal key={f.q} delay={i * 40}>
            <details className="group py-5">
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
    <section className="mx-auto max-w-6xl px-5 pb-28 sm:px-8">
      <Reveal>
        <div className="rounded-[2.5rem] bg-[#141A17]/[0.04] p-2 ring-1 ring-[#141A17]/[0.06]">
          <div className="rounded-[2rem] bg-white px-6 py-16 text-center shadow-[inset_0_1px_1px_rgba(255,255,255,0.85),0_40px_90px_-50px_rgba(20,26,23,0.3)] sm:px-12">
            <h2 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
              Siap membuat AI bekerja untuk usaha Anda?
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base text-[#141A17]/65">
              Hubungkan data, ajarkan aturan, atur izin, lalu deploy agent ke WhatsApp dalam hitungan menit.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <PrimaryButton href="/register">Coba gratis</PrimaryButton>
              <GhostButton href="/login">Masuk dashboard</GhostButton>
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
          <FooterCol title="Produk" links={[{ label: "Cara Kerja", href: "#cara-kerja" }, { label: "Fitur", href: "#fitur" }, { label: "Keamanan", href: "#keamanan" }, { label: "FAQ", href: "#faq" }]} />
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
