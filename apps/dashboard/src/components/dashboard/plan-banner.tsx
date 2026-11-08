import Link from "next/link";
import type { EntitlementsView } from "@/components/dashboard/entitlements-context";

// Owner-only quota banner (PRD 14). Renders nothing when every counter is
// healthy. A hard-stop credit state is the most severe signal.

type Notice = { text: string; tone: "warn" | "bad" };

export function PlanBanner({ entitlements }: { entitlements: EntitlementsView | null }) {
  if (!entitlements) return null;
  const usage = entitlements.usage;
  const notices: Notice[] = [];

  const credits = entitlements.aiCreditsPerMonth;
  if (credits !== null && credits > 0) {
    const pct = Math.round((usage.creditsUsed / credits) * 100);
    if (pct >= 100) {
      notices.push({
        text: `Kredit AI habis (${usage.creditsUsed.toLocaleString("id-ID")}/${credits.toLocaleString("id-ID")}). Agen berhenti membalas otomatis.`,
        tone: "bad",
      });
    } else if (pct >= 80) {
      notices.push({
        text: `Kredit AI terpakai ${pct}% (${usage.creditsUsed.toLocaleString("id-ID")}/${credits.toLocaleString("id-ID")}).`,
        tone: "warn",
      });
    }
  }

  const mau = entitlements.mauLimit;
  if (mau !== null && mau > 0) {
    const pct = Math.round((usage.mau / mau) * 100);
    if (pct >= 100) {
      notices.push({
        text: `MAU melewati batas (${usage.mau.toLocaleString("id-ID")}/${mau.toLocaleString("id-ID")}).`,
        tone: "bad",
      });
    } else if (pct >= 80) {
      notices.push({ text: `MAU terpakai ${pct}%.`, tone: "warn" });
    }
  }

  if (entitlements.staffLimit !== null && usage.staff >= entitlements.staffLimit) {
    notices.push({
      text: `Seat staf penuh (${usage.staff}/${entitlements.staffLimit}).`,
      tone: "warn",
    });
  }
  if (entitlements.channelLimit !== null && usage.channels >= entitlements.channelLimit) {
    notices.push({
      text: `Saluran aktif penuh (${usage.channels}/${entitlements.channelLimit}).`,
      tone: "warn",
    });
  }
  if (entitlements.billingOverdue) {
    notices.push({ text: "Ada tagihan yang sudah jatuh tempo.", tone: "bad" });
  }

  if (notices.length === 0) return null;
  const worst = notices.some((n) => n.tone === "bad") ? "bad" : "warn";

  return (
    <div
      className={`mb-4 rounded-xl border bg-white px-4 py-3 shadow-sm ${
        worst === "bad"
          ? "border-red-200 border-l-2 border-l-red-600"
          : "border-amber-200 border-l-2 border-l-amber-500"
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          {notices.map((n) => (
            <p
              key={n.text}
              className={`flex items-start gap-2 text-[13px] ${
                n.tone === "bad" ? "text-red-700" : "text-amber-800"
              }`}
            >
              <span
                className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                  n.tone === "bad" ? "bg-red-600" : "bg-amber-500"
                }`}
              />
              {n.text}
            </p>
          ))}
        </div>
        <Link
          href="/dashboard/plan"
          className="shrink-0 text-[12px] font-medium text-green-700 hover:underline"
        >
          Lihat paket
        </Link>
      </div>
    </div>
  );
}
