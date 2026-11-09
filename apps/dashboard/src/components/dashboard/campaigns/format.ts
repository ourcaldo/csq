import type { CampaignRow } from "@csq/core/types/campaign";

export const WEEKDAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

export function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Local-time "YYYY-MM-DDTHH:MM" for the datetime-local input (it is parsed
// back with `new Date(value)` in the browser's timezone, matching the market).
export function localDateTimeString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function audienceLabel(c: CampaignRow): string {
  if (c.audience === "ALL") return "Semua kontak";
  if (c.audience === "MANUAL") return `${c.contactIds.length} kontak terpilih`;
  return c.audience === "CATEGORY" ? "Kategori" : "Tag";
}

export function scheduleLabel(c: CampaignRow): string {
  const cfg = c.scheduleConfig;
  switch (c.scheduleKind) {
    case "ONCE":
      return `Sekali - ${formatDateTime(cfg.startAt ?? null)}`;
    case "DAILY":
      return `Setiap hari ${cfg.time}`;
    case "WEEKLY":
      return `Setiap ${WEEKDAYS[cfg.dayOfWeek ?? 0]} ${cfg.time}`;
    case "MONTHLY":
      return `Tanggal ${cfg.dayOfMonth} setiap bulan ${cfg.time}`;
    case "INTERVAL":
      return `Setiap ${cfg.everyDays} hari ${cfg.time}`;
  }
}
