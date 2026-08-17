import type { NextApiRequest, NextApiResponse } from "next";
import crypto from "crypto";
import prisma from "@/lib/db";
import { ingestInboundMessage } from "@/lib/inbox";
import { processInboundWithAgent } from "@/lib/agent-loop";
import { cloudApiConfigSchema } from "@/types/whatsapp";
import { parseCloudApiInbound } from "@/services/whatsapp";

// WhatsApp Cloud API webhook. UNAUTHENTICATED — Meta calls it directly, so
// tenantId is resolved from the channel config (looked up by phone_number_id),
// NEVER from the session. Inbound messages are recorded, then the OpenClaw
// agent auto-reply loop is fired off (NOT awaited) so the 200 ACK returns
// within Meta's 5s timeout while the agent runs in the background.

// Meta posts the raw body and we need it for HMAC verification, so disable the
// Next.js body parser and read the stream ourselves.
export const config = { api: { bodyParser: false } };

function readRawBody(req: NextApiRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// X-Hub-Signature-256 = "sha256=<hex>". Constant-time compare against HMAC of
// the raw body with the channel's appSecret.
function verifySignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string
): boolean {
  if (!signatureHeader) return false;
  const prefix = "sha256=";
  if (!signatureHeader.startsWith(prefix)) return false;
  const expected = signatureHeader.slice(prefix.length);
  const hmac = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  if (expected.length !== hmac.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(expected, "utf8"),
    Buffer.from(hmac, "utf8")
  );
}

function queryParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  // ── GET: webhook verification ──
  if (req.method === "GET") {
    const mode = queryParam(req.query["hub.mode"]);
    const challenge = queryParam(req.query["hub.challenge"]);
    const verifyToken = queryParam(req.query["hub.verify_token"]);
    if (mode !== "subscribe" || !verifyToken || !challenge) {
      res.status(403).send("Forbidden");
      return;
    }
    // Find the CLOUD_API channel whose config.verifyToken matches. JSON path
    // filter keeps this multi-tenant ready (each channel its own token).
    const channel = await prisma.channel.findFirst({
      where: {
        provider: "CLOUD_API",
        config: { path: ["verifyToken"], equals: verifyToken },
      },
    });
    if (!channel) {
      res.status(403).send("Forbidden");
      return;
    }
    res.setHeader("Content-Type", "text/plain");
    res.status(200).send(challenge);
    return;
  }

  // ── POST: inbound events ──
  if (req.method === "POST") {
    // Always read the body (needed for HMAC), and always ACK 200 quickly to
    // stay within Meta's 5s timeout. Invalid payloads → 200 + log, never an
    // error code (Meta would retry and spam).
    let raw: Buffer;
    try {
      raw = await readRawBody(req);
    } catch {
      res.status(200).send("EVENT_RECEIVED");
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      res.status(200).send("EVENT_RECEIVED");
      return;
    }

    const inboundMessages = parseCloudApiInbound(payload);
    if (inboundMessages.length === 0) {
      // Status update or unknown type — nothing to ingest. ACK and return.
      res.status(200).send("EVENT_RECEIVED");
      return;
    }

    // All messages in one POST share the same phone_number_id (one channel).
    const phoneNumberId = inboundMessages[0].phoneNumberId;
    const channel = await prisma.channel.findFirst({
      where: {
        provider: "CLOUD_API",
        config: { path: ["phoneNumberId"], equals: phoneNumberId },
      },
    });
    if (!channel) {
      // Unknown number — ACK to stop retries, but do nothing.
      res.status(200).send("EVENT_RECEIVED");
      return;
    }

    // Signature verification (recommended). Requires appSecret in channel
    // config; if absent, log a warning and proceed (dev convenience — the
    // integrator should set appSecret for production).
    const sigHeader = req.headers["x-hub-signature-256"];
    const signature = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
    const configResult = cloudApiConfigSchema.safeParse(channel.config);
    const appSecret = configResult.success ? configResult.data.appSecret : undefined;
    if (!appSecret) {
      console.warn(
        `[whatsapp-webhook] Channel ${channel.id} has no appSecret; skipping signature verification.`
      );
    } else if (!verifySignature(raw, signature, appSecret)) {
      res.status(401).send("Unauthorized");
      return;
    }

    // Ingest each message via the shared path. Tenant comes from the channel,
    // never from message content. Then fire-and-forget the agent auto-reply
    // loop — NOT awaited, so the ACK below returns immediately. The loop
    // resolves the agent (conversation assignment or channel default), runs
    // OpenClaw, sends the reply via the provider, and records it. A human-owned
    // conversation makes the loop stand down (FR-AS-003).
    for (const m of inboundMessages) {
      const recorded = await ingestInboundMessage({
        channelId: channel.id,
        tenantId: channel.tenantId,
        from: m.from,
        body: m.body,
        waMessageId: m.waMessageId,
        receivedAt: m.timestamp,
        customerName: m.customerName,
      });
      void processInboundWithAgent({
        channel,
        conversationId: recorded.conversationId,
        customerPhone: m.from,
        body: m.body,
      });
    }

    res.status(200).send("EVENT_RECEIVED");
    return;
  }

  res.status(405).send("Method Not Allowed");
}
