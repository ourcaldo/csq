// Tag color helpers: validate/normalize a user-supplied hex string, generate a
// random hex when the owner leaves the color field empty, and pick a readable
// text color for a colored chip. Kept here so both the tag API (server) and the
// inbox chip renderer (client) share one source of truth.
//
// The `color` column on Tag is a free-form nullable string; these helpers make
// it always land as a normalized `#rrggbb` (or null) and render legibly.

const HEX_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

/** Normalize any user input to a lowercase `#rrggbb`, or `null` if invalid/empty. */
export function normalizeHex(input: string | null | undefined): string | null {
  if (!input) return null;
  const m = input.trim().match(HEX_RE);
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return `#${h.toLowerCase()}`;
}

/** Random `#rrggbb` — used when the owner saves a tag without picking a color. */
export function randomHex(): string {
  const n = Math.floor(Math.random() * 0xffffff);
  return `#${n.toString(16).padStart(6, "0")}`;
}

/**
 * Pick a readable foreground (near-black or white) for a hex background, using
 * WCAG sRGB relative luminance. Returns `null` when the input is not a usable
 * color, so the caller can fall back to its default Tailwind classes.
 */
export function readableTextColor(hex: string | null | undefined): string | null {
  const h = normalizeHex(hex);
  if (!h) return null;
  const r = parseInt(h.slice(1, 3), 16);
  const g = parseInt(h.slice(3, 5), 16);
  const b = parseInt(h.slice(5, 7), 16);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.55 ? "#1e293b" : "#ffffff";
}
