// CTA before the footer (adapted from the Velorah CTA spec). A headline +
// primary button on the left, a CSQ dashboard mock pinned to the right with a
// soft green gradient foreground in front. Parallax is native CSS
// animation-timeline: view() (zero JS, GPU composited) where supported,
// disabled under reduced-motion. No external grass image; the foreground is a
// brand-matched CSS gradient.
import Link from "next/link";
import { ArrowRight } from "@phosphor-icons/react";
import { Reveal } from "@/components/landing/reveal";
import { DashboardPreview } from "@/components/landing/dashboard-preview";

export function Cta() {
  return (
    <section id="cta" className="relative w-full overflow-hidden bg-[#FAFAF8]">
      {/* bottom fade into the footer tone */}
      <div
        className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2"
        style={{ background: "linear-gradient(to bottom, transparent, #F0F0EC)" }}
      />
      <div className="relative mx-auto max-w-[1080px] px-4 pt-24 pb-[420px] sm:px-6 sm:pt-32 md:pt-40 md:pb-[440px]">
        <div className="grid grid-cols-1 items-start gap-12 lg:grid-cols-2 lg:gap-8">
          {/* Left copy */}
          <div className="relative z-20 max-w-[400px]">
            <Reveal>
              <h2 className="font-display text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl md:text-5xl">
                Siap membuat AI bekerja untuk usaha Anda?
              </h2>
            </Reveal>
            <Reveal delay={0.1}>
              <p className="mt-6 max-w-[380px] text-base leading-relaxed text-slate-600 sm:text-lg">
                Sambungkan data, ajarkan aturan, atur izin, lalu deploy agent ke WhatsApp. Anda memegang kendali, agent yang bekerja.
              </p>
            </Reveal>
            <Reveal delay={0.2}>
              <div className="mt-10">
                <Link
                  href="/register"
                  className="group group-cta inline-flex items-center gap-2.5 rounded-full bg-green-700 px-7 py-4 text-sm font-semibold text-white shadow-[0_14px_34px_-14px_rgba(21,128,61,0.5)] transition-all duration-700 ease-[cubic-bezier(0.32,0.72,0,1)] hover:bg-green-800 active:scale-[0.98]"
                >
                  Coba gratis
                  <span className="cta-arrow flex h-7 w-7 items-center justify-center rounded-full bg-white/15">
                    <ArrowRight size={14} weight="bold" />
                  </span>
                </Link>
              </div>
            </Reveal>
          </div>
        </div>
      </div>

      {/* Dashboard pinned to the right, parallax Y (native CSS) */}
      <div className="cta-parallax absolute left-4 right-4 top-[440px] z-10 sm:left-auto sm:-right-[8%] sm:top-[460px] md:top-[500px] lg:top-20 sm:w-[85%] md:w-[80%] lg:w-[68%]">
        <DashboardPreview />
      </div>

      {/* Foreground gradient (brand-matched, in front of dashboard) */}
      <div
        aria-hidden
        className="cta-parallax pointer-events-none absolute inset-x-0 bottom-[-40px] z-30 h-[260px] sm:bottom-[-80px] lg:bottom-[-140px]"
        style={{
          background:
            "linear-gradient(to top, rgba(22,163,74,0.18), transparent 70%)",
        }}
      />
    </section>
  );
}
