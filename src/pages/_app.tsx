import type { AppProps } from "next/app";
import type { Session } from "next-auth";
import { SessionProvider } from "next-auth/react";
import "@/styles/globals.css";

// Start the in-process scheduler on server cold start: Google Sheets cron +
// Baileys reconnect (CONNECTED channels) + the keepalive heartbeat. This
// must run at boot, not lazily on first /api/import hit, otherwise a fresh
// instance never connects the Baileys socket and inbound WhatsApp messages
// silently drop. Dynamic import keeps prisma/baileys out of the client
// bundle; the guard ensures it's server-only; startScheduler() is idempotent.
if (typeof window === "undefined") {
  void import("@/services/scheduler").then((m) => m.startScheduler());
}

export default function App({
  Component,
  pageProps,
}: AppProps<{ session?: Session }>) {
  const { session, ...rest } = pageProps;
  return (
    <SessionProvider session={session}>
      <Component {...rest} />
    </SessionProvider>
  );
}
