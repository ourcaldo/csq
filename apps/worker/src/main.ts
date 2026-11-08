// apps/worker entry point (PRD 23C, Phase 6). The customer-serving runtime:
// WhatsApp sockets, every cron tick, the outbox drain, and channel commands.
// The dashboard (apps/dashboard) is a pure UI + BFF now - its deploys can
// never restart these.
//
// No tsconfig of its own on purpose: tsx resolves @csq/core/* through the
// ROOT tsconfig's paths, the same mechanism the scripts/self-check-* tools
// use. DATABASE_URL points at the same Postgres as the dashboard.
import http from "http";
import { startScheduler } from "@csq/core/services/scheduler";
import {
  startChannelRuntime,
  stopChannelRuntime,
} from "@csq/core/services/channel-runtime";
import { shutdownBaileysChannels } from "@csq/core/services/baileys";

// Trivial health listener: Render health checks need a listening port, and
// "is the loop alive" is exactly the question it answers.
const port = Number(process.env.PORT ?? 10000);
const server = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("ok");
});
server.listen(port, () => {
  console.log(`[worker] health listener on ${port}`);
});

startScheduler();
startChannelRuntime();
console.log("[worker] runtime up: scheduler + channel commands + outbox drain");

// Deploy replacement: the platform sends SIGTERM. End every socket WITHOUT
// logout so the saved creds stay valid - the next worker reconnects without
// a QR re-scan.
process.on("SIGTERM", () => {
  console.log("[worker] SIGTERM - shutting down");
  stopChannelRuntime();
  void shutdownBaileysChannels()
    .catch(() => undefined)
    .finally(() => {
      server.close();
      process.exit(0);
    });
});
