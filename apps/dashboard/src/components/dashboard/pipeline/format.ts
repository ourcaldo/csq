// Pipeline board formatting helpers (revamp 2026-11-16).

export function formatRupiah(value: number): string {
  return `Rp ${value.toLocaleString("id-ID")}`;
}

// Relative last-activity label for cards and the drawer header.
export function timeAgo(iso: string | null): string {
  if (!iso) return "-";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "-";
  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 1) return "Baru saja";
  if (minutes < 60) return `${minutes}m lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}j lalu`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "Kemarin";
  if (days < 7) return `${days}hr lalu`;
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
  });
}

export function providerLabel(provider: "CLOUD_API" | "BAILEYS"): string {
  return provider === "CLOUD_API" ? "WhatsApp Resmi" : "WhatsApp Pribadi";
}

export function initialOf(name: string | null | undefined): string {
  return (name?.trim().charAt(0) ?? "?").toUpperCase();
}
