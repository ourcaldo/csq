// Assert-based self-check for inbound classification (D6). Run:
//   npx tsx scripts/self-check-inbound-classify.ts
// No database needed: parseCloudApiInbound is a pure payload -> records map.
// Verifies the three-way kind split the webhook branches on.
import { parseCloudApiInbound } from "../apps/dashboard/src/services/whatsapp";
import type { ParsedInbound } from "../apps/dashboard/src/types/whatsapp";

function wrap(type: string, extra: Record<string, unknown>): ParsedInbound[] {
  return parseCloudApiInbound({
    object: "whatsapp_business_account",
    entry: [
      {
        id: "e1",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "123" },
              contacts: [{ wa_id: "628111", profile: { name: "Test" } }],
              messages: [
                {
                  type,
                  id: "wamid.X",
                  from: "628111",
                  timestamp: "1730000000",
                  ...extra,
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

const checks: Array<[string, boolean]> = [
  [
    "plain text -> text",
    wrap("text", { text: { body: "halo" } })[0]?.kind === "text" &&
      wrap("text", { text: { body: "halo" } })[0]?.body === "halo",
  ],
  [
    "image with caption -> text (caption is text)",
    wrap("image", { image: { caption: "ini kopi?" } })[0]?.kind === "text" &&
      wrap("image", { image: { caption: "ini kopi?" } })[0]?.body === "ini kopi?",
  ],
  [
    "image without caption -> media + [image] placeholder",
    wrap("image", { image: {} })[0]?.kind === "media" &&
      wrap("image", { image: {} })[0]?.body === "[image]",
  ],
  [
    "sticker -> media",
    wrap("sticker", { sticker: {} })[0]?.kind === "media",
  ],
  [
    "audio -> media",
    wrap("audio", { audio: {} })[0]?.kind === "media",
  ],
  [
    "reaction -> other (stored, never answered)",
    wrap("reaction", { reaction: {} })[0]?.kind === "other",
  ],
  [
    "unsupported -> other",
    wrap("unsupported", {})[0]?.kind === "other",
  ],
  [
    "customer name still parsed",
    wrap("text", { text: { body: "halo" } })[0]?.customerName === "Test",
  ],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(ok ? "PASS" : "FAIL", "-", name);
  if (!ok) failed++;
}
if (failed > 0) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("all inbound-classification checks passed");
