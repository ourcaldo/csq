// PRD 30: Web Push service worker. Shows the notification while every
// dashboard tab is hidden/closed; when a dashboard window is visible the
// foreground SSE listener owns it (smarter suppression there). Click
// focuses an open dashboard tab (navigating it to the conversation) or
// opens a new one.

// Activate updates immediately - without this, a fixed sw.js can sit
// "waiting" indefinitely while every open dashboard tab keeps the old SW.
self.addEventListener("install", () => {
  self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let data = {};
      try {
        data = event.data ? event.data.json() : {};
      } catch {
        data = {};
      }
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      const visible = clients.some((c) => c.visibilityState === "visible");
      if (visible) return;
      await self.registration.showNotification(data.title || "CSQ", {
        body: data.body || "Pesan baru masuk",
        tag: data.tag,
        icon: "/icon.svg",
        badge: "/icon.svg",
        silent: false,
        data: { conversationId: data.conversationId },
      });
    })()
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const conversationId = event.notification.data && event.notification.data.conversationId;
  const url = conversationId
    ? "/dashboard/inbox?c=" + encodeURIComponent(conversationId)
    : "/dashboard/inbox";
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const client of clients) {
        if (client.url.indexOf("/dashboard") !== -1) {
          await client.focus();
          if ("navigate" in client) await client.navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })()
  );
});
