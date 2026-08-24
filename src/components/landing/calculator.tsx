// CSQ self-host cost estimator (adapted from the project-estimation calculator spec).
// Dark section, 2-column: left = dark form (conversation volume slider,
// add-ons, host tier), right = cost cards (VPS, Cloud API, Total with a
// green gradient). Native range input (no shadcn Slider in the project),
// Phosphor checks, cn, useState. All figures in Rupiah, .toLocaleString.
import { useState } from "react";
import { Check } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";

type HostTier = "vps" | "render" | "dedicated";
type AddonKey = "sheets" | "baileys" | "staff";

const ADDONS: { key: AddonKey; label: string; price: string }[] = [
  { key: "sheets", label: "Sinkronisasi Google Sheets", price: "+Rp200 / percakapan" },
  { key: "baileys", label: "Nomor WA sendiri (Baileys)", price: "+Rp25.000 flat" },
  { key: "staff", label: "Multi-staff (tim)", price: "+Rp1.000 / percakapan" },
];

const HOSTS: { tier: HostTier; label: string }[] = [
  { tier: "vps", label: "Self-host VPS" },
  { tier: "render", label: "Render (terkelola)" },
  { tier: "dedicated", label: "Server dedicated" },
];

function formatRp(n: number): string {
  return "Rp" + Math.round(n).toLocaleString("id-ID");
}

function calculateHost(tier: HostTier, conversations: number): number {
  const base = tier === "vps" ? 75000 : tier === "render" ? 90000 : 250000;
  return base + (conversations - 1) * 5000;
}

function calculateWhatsApp(conversations: number, addons: Record<AddonKey, boolean>): number {
  let cloud = conversations * 1500;
  if (addons.sheets) cloud += conversations * 200;
  if (addons.staff) cloud += conversations * 1000;
  return cloud;
}

export function Calculator() {
  const [conversations, setConversations] = useState(5);
  const [addons, setAddons] = useState<Record<AddonKey, boolean>>({
    sheets: false,
    baileys: false,
    staff: false,
  });
  const [host, setHost] = useState<HostTier>("vps");

  function toggle(key: AddonKey) {
    setAddons((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const hostCost = calculateHost(host, conversations);
  const waCost = calculateWhatsApp(conversations, addons) + (addons.baileys ? 25000 : 0);
  const total = hostCost + waCost;

  return (
    <section id="biaya" className="bg-[#0D0D0D] py-16 text-white md:py-28">
      <div className="mx-auto max-w-7xl px-4 md:px-16">
        <div className="mb-12 text-center">
          <p className="font-mono-data text-xs uppercase tracking-[0.2em] text-white/50">Estimasi biaya self-host</p>
          <h2 className="mt-3 font-display text-3xl font-normal tracking-tight md:text-4xl lg:text-5xl">
            Hitung biaya CSQ untuk usaha Anda
          </h2>
        </div>

        <div className="grid grid-cols-1 overflow-hidden rounded-2xl lg:grid-cols-2">
          {/* Left: form */}
          <div className="divide-y divide-[#1E1E1E] bg-[#0D0D0D] p-8 lg:p-12">
            {/* Conversation volume */}
            <div className="pb-8">
              <h3 className="text-sm font-semibold">Berapa percakapan per bulan?</h3>
              <div className="mt-4 flex items-center gap-4">
                <input
                  type="range"
                  min={1}
                  max={30}
                  step={1}
                  value={conversations}
                  onChange={(e) => setConversations(Number(e.target.value))}
                  className="h-2 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-[#FF5656]"
                  aria-label="Jumlah percakapan"
                />
                <span className="w-10 shrink-0 text-right font-mono-data text-lg font-bold text-[#FF5656]">{conversations}</span>
              </div>
              <div className="mt-2 flex justify-between text-xs text-white/40">
                <span>1</span>
                <span>30</span>
              </div>
            </div>

            {/* Host tier */}
            <div className="py-8">
              <h3 className="text-sm font-semibold">Di mana CSQ dihosting?</h3>
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
                        host === h.tier ? "border-[#FF5656]" : "border-white/30"
                      )}
                    >
                      {host === h.tier && <span className="h-2 w-2 rounded-full bg-[#FF5656]" />}
                    </span>
                    <span className="text-sm">{h.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Add-ons */}
            <div className="pt-8">
              <h3 className="text-sm font-semibold">Tambahan</h3>
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
                          addons[a.key] ? "border-[#FF5656] bg-[#FF5656] text-white" : "border-white/30"
                        )}
                      >
                        {addons[a.key] && <Check size={12} weight="bold" />}
                      </span>
                      <span className="text-sm">{a.label}</span>
                    </span>
                    <span className="font-mono-data text-xs text-[#FF5656]">{a.price}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Right: cost cards */}
          <div className="min-h-[717px] rounded-r-2xl border border-white/10 p-8 lg:p-12">
            <h3 className="text-sm font-semibold text-white/80">Estimasi biaya per bulan</h3>
            <p className="mt-2 text-xs text-white/40">
              Angka kasar untuk {conversations} percakapan, host {HOSTS.find((h) => h.tier === host)?.label.toLowerCase()}.
            </p>

            <div className="mt-6 space-y-3">
              <CostCard title="Server (VPS / host)" subtitle="Self-host, data milik Anda" price={hostCost} />
              <CostCard title="WhatsApp Cloud API" subtitle="Biaya pesan Meta" price={waCost} />
              <CostCard
                title="Total per bulan"
                subtitle="Hemat vs agency atau freelancer"
                price={total}
                highlight
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CostCard({ title, subtitle, price, highlight = false }: { title: string; subtitle: string; price: number; highlight?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-2xl p-6",
        highlight ? "bg-gradient-to-r from-green-600 to-emerald-500 text-white" : "bg-white/5 text-white"
      )}
    >
      <p className={cn("text-xs", highlight ? "text-white/80" : "text-white/50")}>{title}</p>
      <p className="mt-3 text-4xl font-bold tracking-tight">{formatRp(price)}</p>
      <p className={cn("mt-1 text-xs", highlight ? "text-white/80" : "text-white/40")}>{subtitle}</p>
    </div>
  );
}
