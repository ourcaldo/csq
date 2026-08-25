// CSQ cost estimator. Host options: Self-host and Cloud (coming soon).
// Server/host cost is a flat monthly fee per tier (only the WhatsApp
// Cloud API scales per conversation). All add-ons are free. Conversation
// volume up to 100. CSQ-green design (not plain): soft green gradient
// section, white form panel with a green border, total card with a green
// gradient + glow. Native range input, Phosphor checks, cn, useState.
import { useState } from "react";
import { Check } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

type HostTier = "vps" | "cloud";
type AddonKey = "sheets" | "baileys" | "staff";

const ADDONS: { key: AddonKey; label: string }[] = [
  { key: "sheets", label: "Sinkronisasi Google Sheets" },
  { key: "baileys", label: "Nomor WA sendiri (Baileys)" },
  { key: "staff", label: "Multi-staff (tim)" },
];

const HOSTS: { tier: HostTier; label: string }[] = [
  { tier: "vps", label: "Self-host" },
  { tier: "cloud", label: "Cloud (coming soon)" },
];

function formatRp(n: number): string {
  return "Rp" + Math.round(n).toLocaleString("id-ID");
}

// Server/host cost is a flat monthly fee per tier - it does NOT scale with
// conversation volume. Only the WhatsApp Cloud API cost scales.
function calculateHost(tier: HostTier): number {
  if (tier === "cloud") return -1; // coming soon sentinel
  return 75000;
}

function calculateWhatsApp(conversations: number): number {
  return conversations * 1500; // all add-ons are free
}

export function Calculator() {
  const [conversations, setConversations] = useState(10);
  const [addons, setAddons] = useState<Record<AddonKey, boolean>>({
    sheets: false,
    baileys: false,
    staff: false,
  });
  const [host, setHost] = useState<HostTier>("vps");

  const cloudComingSoon = host === "cloud";
  const hostCost = calculateHost(host);
  const waCost = calculateWhatsApp(conversations);
  const total = hostCost + waCost;

  function toggle(key: AddonKey) {
    setAddons((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <section id="biaya" className="bg-gradient-to-b from-green-50/70 via-[#F4FBF7] to-white py-16 text-slate-900 md:py-28">
      <div className="mx-auto max-w-7xl px-4 md:px-16">
        <div className="mb-12 text-center">
          <p className="font-mono-data text-xs uppercase tracking-[0.2em] text-green-700">Estimasi biaya CSQ</p>
          <h2 className="mt-3 font-display text-3xl font-extrabold tracking-tight md:text-4xl lg:text-5xl">
            Hitung biaya CSQ untuk usaha Anda
          </h2>
          <p className="mt-4 max-w-xl mx-auto text-base leading-relaxed text-slate-600">
            Self-host gratis; Anda hanya membayar server dan biaya pesan WhatsApp.
          </p>
        </div>

        <div className="grid grid-cols-1 overflow-hidden rounded-2xl shadow-[0_30px_90px_-40px_rgba(21,128,61,0.25)] lg:grid-cols-2">
          {/* Left: form */}
          <div className="divide-y divide-slate-100 border border-green-200/60 bg-white p-8 lg:p-12">
            {/* Conversation volume */}
            <div className="pb-8">
              <h3 className="text-sm font-semibold text-slate-900">Berapa percakapan per bulan?</h3>
              <div className="mt-4 flex items-center gap-4">
                <input
                  type="range"
                  min={1}
                  max={100}
                  step={1}
                  value={conversations}
                  onChange={(e) => setConversations(Number(e.target.value))}
                  className="h-2 w-full cursor-pointer appearance-none rounded-full bg-green-100 accent-green-600"
                  aria-label="Jumlah percakapan"
                />
                <span className="w-10 shrink-0 text-right font-mono-data text-lg font-bold text-green-700">{conversations}</span>
              </div>
              <div className="mt-2 flex justify-between text-xs text-slate-400">
                <span>1</span>
                <span>100</span>
              </div>
            </div>

            {/* Host tier */}
            <div className="py-8">
              <h3 className="text-sm font-semibold text-slate-900">Di mana CSQ dihosting?</h3>
              <div className="mt-4 space-y-2.5">
                {HOSTS.map((h) => (
                  <button
                    key={h.tier}
                    onClick={() => setHost(h.tier)}
                    className="flex w-full items-center gap-3 text-left"
                  >
                    <span
                      className={cn(
                        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                        host === h.tier ? "border-green-600" : "border-slate-300"
                      )}
                    >
                      {host === h.tier && <span className="h-2 w-2 rounded-full bg-green-600" />}
                    </span>
                    <span className="text-sm text-slate-700">{h.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Add-ons (all free) */}
            <div className="pt-8">
              <h3 className="text-sm font-semibold text-slate-900">Tambahan (gratis)</h3>
              <div className="mt-4 space-y-3">
                {ADDONS.map((a) => (
                  <button
                    key={a.key}
                    onClick={() => toggle(a.key)}
                    className="flex w-full items-center justify-between gap-3 text-left"
                  >
                    <span className="flex items-center gap-3">
                      <span
                        className={cn(
                          "flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors",
                          addons[a.key] ? "border-green-600 bg-green-600 text-white" : "border-slate-300"
                        )}
                      >
                        {addons[a.key] && <Check size={12} weight="bold" />}
                      </span>
                      <span className="text-sm text-slate-700">{a.label}</span>
                    </span>
                    <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-[10px] font-semibold text-green-700">Gratis</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right: cost cards */}
          <div className="min-h-[717px] border border-green-200/60 bg-gradient-to-b from-white to-green-50/40 p-8 lg:p-12">
            <h3 className="text-sm font-semibold text-slate-900">Estimasi biaya per bulan</h3>
            <p className="mt-2 text-xs text-slate-400">
              Angka kasar untuk {conversations} percakapan{cloudComingSoon ? ", host Cloud (coming soon)" : ""}.
            </p>

            <div className="mt-6 space-y-3">
              <CostCard
                title="Server (host)"
                subtitle={cloudComingSoon ? "Opsi Cloud segera hadir" : "Biaya tetap per bulan, tidak naik dengan volume"}
                price={cloudComingSoon ? undefined : hostCost}
              />
              <CostCard title="WhatsApp Cloud API" subtitle="Biaya pesan Meta per percakapan" price={waCost} />
              <CostCard
                title="Total per bulan"
                subtitle="Hemat vs agency atau freelancer"
                price={cloudComingSoon ? undefined : total}
                highlight
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CostCard({ title, subtitle, price, highlight = false }: { title: string; subtitle: string; price?: number; highlight?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-2xl p-6",
        highlight
          ? "bg-gradient-to-r from-green-600 to-emerald-500 text-white shadow-[0_20px_50px_-20px_rgba(21,128,61,0.55)]"
          : "border border-green-100 bg-white text-slate-900 shadow-sm"
      )}
    >
      <p className={cn("text-xs", highlight ? "text-white/80" : "text-green-700/70")}>{title}</p>
      {price === undefined ? (
        <p className="mt-3 text-3xl font-bold tracking-tight">Coming soon</p>
      ) : (
        <p className="mt-3 text-4xl font-bold tracking-tight">{formatRp(price)}</p>
      )}
      <p className={cn("mt-1 text-xs", highlight ? "text-white/80" : "text-slate-400")}>{subtitle}</p>
    </div>
  );
}
