import prisma from "@csq/core/lib/db";
import { visibleChannelIdsForUser } from "@csq/core/lib/channel-access";

// web-push is CommonJS: the worker runs pure ESM (tsx), where a static
// default import fails ("does not provide an export named 'default'").
// A cached dynamic import gives the same module under both the ESM worker
// and the webpack-bundled Next services (default = module.exports there).
type WebPushModule = typeof import("web-push");
let webPushModule: WebPushModule | null = null;
async function loadWebPush(): Promise<WebPushModule> {
  if (webPushModule) return webPushModule;
  const mod: WebPushModule & { default?: WebPushModule } = await import("web-push");
  webPushModule = mod.default ?? mod;
  return webPushModule;
}

// PRD 30: Web Push for inbound customer messages. Called fire-and-forget
// from ingestInboundMessage (the single ingest choke point both the Cloud
// API webhook and the Baileys runtime cross), so a closed dashboard still
// notifies. Everything is re-evaluated server-side: user preference,
// channel visibility (PRD 29 LIHAT) and assignment scope - the browser is
// never trusted with scope.

export type InboxNotifyScope = "all" | "assigned" | "off";

// Stored as User.notificationPrefs JSON. Unknown/missing = "all" (owner
// decision 2026-11-24: everyone notifies for every visible conversation).
export function inboxNotifyScope(prefs: unknown): InboxNotifyScope {
  if (prefs && typeof prefs === "object" && "inboxNotify" in prefs) {
    const value = prefs.inboxNotify;
    if (value === "all" || value === "assigned" || value === "off") return value;
  }
  return "all";
}

const SNIPPET_MAX = 80;
// PRD 30 section 6: max 1 push per (user, conversation) per 10s. Per
// process (api and worker each hold their own) - a coarse flood guard, not
// an exact global rate limit.
const PUSH_WINDOW_MS = 10_000;
const lastPushAt = new Map<string, number>();

let vapidConfigured = false;
async function configureVapid(): Promise<WebPushModule | null> {
  const webpush = await loadWebPush();
  if (vapidConfigured) return webpush;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) return null;
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_CONTACT ?? "admin@csq.local"}`,
    publicKey,
    privateKey
  );
  vapidConfigured = true;
  return webpush;
}

export type InboundPushInput = {
  tenantId: string;
  conversationId: string;
  channelId: string;
  customerPhone: string;
  customerName?: string;
  body: string;
};

// Fire-and-forget: all failures are swallowed and logged - a push must
// never affect ingest, and a missing VAPID env simply disables delivery.
export async function sendInboundPush(input: InboundPushInput): Promise<void> {
  try {
    const webpush = await configureVapid();
    if (!webpush) {
      console.warn("[push] VAPID keys unset; skipping inbound push.");
      return;
    }
    // Runs inside the caller's tenant context (ingest entered it).
    const conversation = await prisma.conversation.findFirst({
      where: { id: input.conversationId, tenantId: input.tenantId },
      select: { assigneeUserId: true },
    });
    if (!conversation) return;

    const users = await prisma.user.findMany({
      where: { tenantId: input.tenantId },
      select: {
        id: true,
        notificationPrefs: true,
        pushSubscriptions: { select: { id: true, endpoint: true, p256dh: true, auth: true } },
      },
    });

    const title = (input.customerName?.trim() || input.customerPhone).slice(0, 120);
    const snippet =
      input.body.trim().slice(0, SNIPPET_MAX) || "Pesan baru";
    const payload = JSON.stringify({
      conversationId: input.conversationId,
      title,
      body: snippet,
      tag: input.conversationId,
    });

    for (const user of users) {
      if (user.pushSubscriptions.length === 0) continue;
      const scope = inboxNotifyScope(user.notificationPrefs);
      if (scope === "off") continue;
      if (scope === "assigned" && conversation.assigneeUserId !== user.id) continue;

      const visible = await visibleChannelIdsForUser(input.tenantId, user.id);
      if (visible !== null && !visible.includes(input.channelId)) continue;

      const capKey = `${user.id}:${input.conversationId}`;
      const now = Date.now();
      const last = lastPushAt.get(capKey) ?? 0;
      if (now - last < PUSH_WINDOW_MS) continue;
      lastPushAt.set(capKey, now);
      if (lastPushAt.size > 5000) lastPushAt.clear();

      for (const sub of user.pushSubscriptions) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload,
            { TTL: 3600 }
          );
        } catch (err: unknown) {
          const status =
            err && typeof err === "object" && "statusCode" in err
              ? err.statusCode
              : undefined;
          if (status === 404 || status === 410) {
            // Browser uninstalled / subscription expired: prune the row.
            await prisma.pushSubscription.delete({ where: { id: sub.id } }).catch(() => undefined);
          } else {
            console.error("[push] send failed:", status ?? err);
          }
        }
      }
    }
  } catch (err: unknown) {
    console.error("[push] inbound push failed:", err);
  }
}
