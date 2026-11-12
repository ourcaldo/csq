import assert from "assert";
import {
  isVisionImage,
  buildUserContent,
  resolveUserText,
  VISION_MAX_IMAGE_BYTES,
} from "@csq/core/lib/vision";

// Vision self-check (PRD 03 amendment 2026-11-12). Pure helpers only, no DB:
//   npm run check:vision

// The gate: photos yes (jpeg + webp stickers ride along), everything else no.
assert.strictEqual(isVisionImage("image/jpeg", 100_000), true);
assert.strictEqual(isVisionImage("image/webp", 5_000), true);
assert.strictEqual(isVisionImage("video/mp4", 100_000), false);
assert.strictEqual(isVisionImage("audio/ogg", 100_000), false);
assert.strictEqual(isVisionImage("application/pdf", 100_000), false);
assert.strictEqual(isVisionImage("image/jpeg", 0), false);
assert.strictEqual(isVisionImage("image/jpeg", VISION_MAX_IMAGE_BYTES + 1), false);
assert.strictEqual(isVisionImage("image/jpeg", VISION_MAX_IMAGE_BYTES), true);

// The multimodal user message: text part first, then the base64 data URL.
const parts = buildUserContent("coba lihat ini", {
  data: Buffer.from([1, 2, 3]),
  mimeType: "image/jpeg",
});
if (typeof parts === "string") throw new Error("expected content array");
assert.strictEqual(parts.length, 2);
if (parts[0].type !== "text") throw new Error("expected text part first");
assert.strictEqual(parts[0].text, "coba lihat ini");
if (parts[1].type !== "image_url") throw new Error("expected image part second");
assert.strictEqual(
  parts[1].image_url.url,
  "data:image/jpeg;base64," + Buffer.from([1, 2, 3]).toString("base64")
);

// Placeholder photos get a natural line; captions are kept as-is.
assert.strictEqual(resolveUserText("[image]", true), "Pelanggan mengirimkan foto ini.");
assert.strictEqual(resolveUserText("", true), "Pelanggan mengirimkan foto ini.");
assert.strictEqual(resolveUserText("ini harga berapa ya?", true), "ini harga berapa ya?");
assert.strictEqual(resolveUserText("[image]", false), "[image]");

console.log("vision self-check passed");
