// PRD 30: client half of inbox notifications. Mounted once by the
// DashboardShell so every page has it. Two independent halves:
// - INTERNAL notification center (owner amendment 2026-11-24): the topbar
//   bell lists the user's unread conversations, derived server-side from
//   the ConversationRead watermark - this provider fetches and refreshes it.
// - BROWSER notifications: permission + Web Push subscription + the
//   tenant-wide notify-stream SSE that fires OS toasts (scope: all /
//   assigned / off, default all).
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/router";
import { apiFetch, apiSend } from "@/lib/api-client";

export type InboxNotifyScope = "all" | "assigned" | "off";
type PermissionState = "default" | "granted" | "denied" | "unsupported";

export type InboxNotificationItem = {
  conversationId: string;
  title: string;
  snippet: string;
  channelLabel: string;
  at: string;
};

type StreamEvent = {
  conversationId: string;
  channelId: string;
  title: string;
  body: string;
};

function isStreamEvent(value: unknown): value is StreamEvent {
  if (!value || typeof value !== "object") return false;
  const v: Record<string, unknown> = { ...value };
  return (
    typeof v.conversationId === "string" &&
    typeof v.channelId === "string" &&
    typeof v.title === "string" &&
    typeof v.body === "string"
  );
}

type NotificationsValue = {
  scope: InboxNotifyScope;
  setScope: (scope: InboxNotifyScope) => void;
  permission: PermissionState;
  requestPermission: () => Promise<void>;
  // Internal notification center (bell).
  items: InboxNotificationItem[];
  total: number;
  refresh: () => void;
};

const NotificationsContext = createContext<NotificationsValue | null>(null);

export function useNotifications(): NotificationsValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications outside the shell provider");
  return ctx;
}

// PRD 30 section 6: max 1 toast per conversation per 10s client-side.
const TOAST_WINDOW_MS = 10_000;

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return buffer;
}

type PushSubscriptionJson = {
  endpoint?: string;
  keys?: { p256dh?: string; auth?: string };
};

async function syncPushSubscription(scope: InboxNotifyScope, vapidKey: string | null) {
  if (typeof window === "undefined") return;
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
  try {
    const reg = await navigator.serviceWorker.register("/sw.js");
    const existing = await reg.pushManager.getSubscription();
    if (scope === "off" || Notification.permission !== "granted" || !vapidKey) {
      if (existing) {
        await apiSend("/api/dashboard/notifications/subscribe", "DELETE", {
          endpoint: existing.endpoint,
        }).catch(() => undefined);
        await existing.unsubscribe().catch(() => undefined);
      }
      return;
    }
    const sub =
      existing ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey),
      }));
    const json: PushSubscriptionJson = sub.toJSON();
    if (json.endpoint && json.keys?.p256dh && json.keys?.auth) {
      await apiSend("/api/dashboard/notifications/subscribe", "POST", {
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
      });
    }
  } catch (err) {
    console.error("[notifications] push sync failed:", err);
  }
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [scope, setScopeState] = useState<InboxNotifyScope>("all");
  const [permission, setPermission] = useState<PermissionState>("unsupported");
  const [items, setItems] = useState<InboxNotificationItem[]>([]);
  const [total, setTotal] = useState(0);
  const vapidKeyRef = useRef<string | null>(null);
  const lastToastAt = useRef(new Map<string, number>());

  // Internal bell feed: unread conversations from the server watermark.
  const refresh = useCallback(() => {
    apiFetch<{ items: InboxNotificationItem[]; total: number }>(
      "/api/dashboard/inbox/notifications"
    )
      .then((d) => {
        setItems(d.items);
        setTotal(d.total);
      })
      .catch(() => undefined);
  }, []);

  // Initial state: preference + VAPID public key + browser permission.
  useEffect(() => {
    if (typeof window === "undefined") return;
    setPermission(
      typeof Notification === "undefined" ? "unsupported" : Notification.permission
    );
    apiFetch<{ inboxNotify: InboxNotifyScope; vapidPublicKey: string | null }>(
      "/api/dashboard/settings/notifications"
    )
      .then((d) => {
        setScopeState(d.inboxNotify);
        vapidKeyRef.current = d.vapidPublicKey;
        if (Notification.permission === "granted") {
          void syncPushSubscription(d.inboxNotify, d.vapidPublicKey);
        }
      })
      .catch(() => undefined);
  }, []);

  // Bell feed refreshes on route change (opening a thread writes the read
  // watermark) and whenever an inbound event arrives.
  useEffect(() => {
    refresh();
  }, [router.pathname, refresh]);

  const setScope = useCallback((next: InboxNotifyScope) => {
    setScopeState(next);
    apiSend<{ vapidPublicKey: string | null }>(
      "/api/dashboard/settings/notifications",
      "POST",
      { inboxNotify: next }
    )
      .then((d) => {
        vapidKeyRef.current = d.vapidPublicKey;
      })
      .catch(() => undefined);
    void syncPushSubscription(next, vapidKeyRef.current);
  }, []);

  const requestPermission = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setPermission(result);
    if (result === "granted") {
      await syncPushSubscription(scope, vapidKeyRef.current);
    }
  }, [scope]);

  // Foreground listener: the tenant-wide SSE stream. Only while a non-off
  // scope and the browser granted permission; suppressed for the
  // conversation the user is currently reading.
  useEffect(() => {
    if (scope === "off" || permission !== "granted") return;
    const es = new EventSource("/api/dashboard/inbox/notify-stream");
    es.onmessage = (ev) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (!isStreamEvent(parsed)) return;
      const data = parsed;
      // Keep the internal bell list live too.
      refresh();
      // Reading that exact thread right now? No toast.
      const viewingIt =
        window.location.pathname === "/dashboard/inbox" &&
        new URLSearchParams(window.location.search).get("c") === data.conversationId;
      if (viewingIt) return;

      const now = Date.now();
      const last = lastToastAt.current.get(data.conversationId) ?? 0;
      if (now - last < TOAST_WINDOW_MS) return;
      lastToastAt.current.set(data.conversationId, now);
      if (lastToastAt.current.size > 500) lastToastAt.current.clear();

      try {
        const toast = new Notification(data.title || "Pesan baru", {
          body: data.body || "Pesan baru masuk",
          tag: data.conversationId,
          icon: "/icon.svg",
          silent: false,
        });
        toast.onclick = () => {
          window.focus();
          void router.push(`/dashboard/inbox?c=${encodeURIComponent(data.conversationId)}`);
        };
      } catch (err) {
        console.error("[notifications] toast failed:", err);
      }
    };
    es.onerror = () => {
      // Transient - the browser auto-reconnects; swallow.
    };
    return () => es.close();
  }, [scope, permission, router, refresh]);

  // Document title badge follows the internal unread total.
  useEffect(() => {
    if (total === 0) return;
    const base = document.title.replace(/^\(\d+\+?\)\s*/, "");
    document.title = `(${total > 99 ? "99+" : total}) ${base}`;
  }, [total]);

  const value: NotificationsValue = {
    scope,
    setScope,
    permission,
    requestPermission,
    items,
    total,
    refresh,
  };
  return (
    <NotificationsContext.Provider value={value}>
      {children}
    </NotificationsContext.Provider>
  );
}
