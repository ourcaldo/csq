import type { ChatMessagePart } from "@csq/core/types/chat";

// Vision input (PRD 03 amendment 2026-11-12, owner decision): the agent reads
// customer PHOTOS. Only the triggering message's image rides along - replayed
// history stays text-only so the prompt stays bounded regardless of how many
// photos the customer sends. Non-image media (video/audio/document) keeps the
// ingest-time courtesy reply.

// shortcut: no resize pipeline; WhatsApp compresses photos well under this
// cap, and it stops a giant base64 blob from bloating the LLM request.
export const VISION_MAX_IMAGE_BYTES = 4 * 1024 * 1024;

export function isVisionImage(
  mimeType: string,
  byteSize: number
): boolean {
  return (
    mimeType.startsWith("image/") &&
    byteSize > 0 &&
    byteSize <= VISION_MAX_IMAGE_BYTES
  );
}

// OpenAI multimodal user message: text part + image part (data URL), the
// format every OpenAI-compatible provider accepts.
export function buildUserContent(
  text: string,
  image: { data: Uint8Array; mimeType: string }
): string | ChatMessagePart[] {
  return [
    { type: "text", text },
    {
      type: "image_url",
      image_url: {
        url: `data:${image.mimeType};base64,${Buffer.from(image.data).toString("base64")}`,
      },
    },
  ];
}

// An uncaptioned photo carries the "[image]" placeholder as its text body;
// give the model a natural line when the actual photo rides along.
export function resolveUserText(body: string, hasImage: boolean): string {
  return hasImage && (!body || body === "[image]")
    ? "Pelanggan mengirimkan foto ini."
    : body;
}
