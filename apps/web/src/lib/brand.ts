// Attcos brand constants for the marketing site (apps/web). The product
// rename is being rolled out in stages (2026-11-24, owner): this file is
// the single source for the web app only. The dashboard, admin and shared
// ui defaults still carry the legacy CSQ brand until the full migration.
export const BRAND_NAME = "Attcos";
export const BRAND_POSITIONING = "Assist. Think. Transform.";
export const BRAND_TAGLINE = "AI-Powered Customer Operations System";
export const BRAND_DESCRIPTION =
  "Attcos - AI-Powered Customer Operations System untuk UMKM Indonesia. Attcos membantu melayani pelanggan di WhatsApp: memahami data bisnis Anda, menjawab 24/7, dan menindak dengan izin Anda.";

// Where the product app (register/login/dashboard) lives. apps/web is a
// separate deploy with no auth routes, so every conversion CTA must leave
// for the app origin; override with NEXT_PUBLIC_APP_URL when the app gets
// its own domain. Self-hosted single-origin deploys set it to their domain.
export const APP_URL = (
  process.env.NEXT_PUBLIC_APP_URL ?? "https://csq-dashboard.onrender.com"
).replace(/\/$/, "");
