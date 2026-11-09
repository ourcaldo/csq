import { createHash } from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { z } from "zod";
import prisma from "@csq/core/lib/db";

// Cross-service alert check (PRD 09, metrics + alerting). Run every 5 minutes
// from Render Cron, a systemd timer, or any external scheduler:
//   npm run check:alerts
//
// It probes:
//   - dashboard /api/health (DB up)
//   - api /api/health (DB up)
//   - worker health listener (process up)
//   - worker-runtime heartbeat (scheduler/channel loop alive, DB lock)
//
// Failures are posted to ALERT_WEBHOOK_URL (Slack/Discord/generic JSON). The
// same failure set is suppressed for 30 minutes so a persistent outage does
// not spam the channel. Exit code 1 on failure so the scheduler records it.

type Failure = { service: string; error: string };

const DASHBOARD_URL = (process.env.DASHBOARD_URL ?? "https://csq-dashboard.onrender.com").replace(/\/$/, "");
const API_URL = (process.env.API_URL ?? "https://csq-api.onrender.com").replace(/\/$/, "");
const WORKER_URL = (process.env.WORKER_URL ?? "https://csq-worker.onrender.com").replace(/\/$/, "");
const WEBHOOK = process.env.ALERT_WEBHOOK_URL?.trim();
const COOLDOWN_MS = 30 * 60 * 1000;
const STATE_PATH = path.join(os.tmpdir(), "csq-alert-state.json");

const healthSchema = z.object({
  success: z.boolean(),
  data: z.object({ status: z.string(), db: z.string() }).optional(),
});

async function checkHealth(name: string, base: string): Promise<Failure | null> {
  try {
    const res = await fetch(`${base}/api/health`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return { service: name, error: `HTTP ${res.status}` };
    const body: unknown = await res.json();
    const parsed = healthSchema.safeParse(body);
    if (!parsed.success) return { service: name, error: "invalid health payload" };
    if (parsed.data.data?.db !== "up") return { service: name, error: "database down" };
    return null;
  } catch (err) {
    return {
      service: name,
      error: err instanceof Error ? err.message : "unreachable",
    };
  }
}

async function checkWorker(): Promise<Failure | null> {
  try {
    const res = await fetch(WORKER_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return { service: "worker", error: `HTTP ${res.status}` };
    const text = await res.text();
    if (text.trim() !== "ok") return { service: "worker", error: "unexpected health body" };
    return null;
  } catch (err) {
    return {
      service: "worker",
      error: err instanceof Error ? err.message : "unreachable",
    };
  }
}

async function checkHeartbeat(): Promise<Failure | null> {
  if (!process.env.DATABASE_URL) {
    console.log("[alerts] DATABASE_URL unset, skipping worker heartbeat check");
    return null;
  }
  try {
    const lock = await prisma.systemLock.findUnique({
      where: { key: "worker-heartbeat" },
    });
    if (!lock) return { service: "worker-runtime", error: "heartbeat missing" };
    if (lock.lockedUntil.getTime() <= Date.now()) {
      return { service: "worker-runtime", error: "heartbeat expired" };
    }
    return null;
  } catch (err) {
    return {
      service: "database",
      error: err instanceof Error ? err.message : "unreachable",
    };
  }
}

type AlertState = { hash: string; at: number };

function readState(): AlertState | null {
  try {
    const raw: unknown = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
    if (typeof raw !== "object" || raw === null) return null;
    if (!("hash" in raw) || !("at" in raw)) return null;
    if (typeof raw.hash !== "string" || typeof raw.at !== "number") return null;
    return { hash: raw.hash, at: raw.at };
  } catch {
    return null;
  }
}

function writeState(state: AlertState): void {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state), "utf8");
  } catch (err) {
    console.error("[alerts] could not write cooldown state:", err);
  }
}

async function main(): Promise<void> {
  const results = await Promise.all([
    checkHealth("dashboard", DASHBOARD_URL),
    checkHealth("api", API_URL),
    checkWorker(),
    checkHeartbeat(),
  ]);
  const failures = results.filter((r): r is Failure => r !== null);

  if (failures.length === 0) {
    console.log("[alerts] all checks healthy");
    return;
  }

  for (const failure of failures) {
    console.error(`[alerts] ${failure.service}: ${failure.error}`);
  }
  process.exitCode = 1;

  if (!WEBHOOK) {
    console.error("[alerts] ALERT_WEBHOOK_URL unset; not sending");
    return;
  }

  const hash = createHash("sha256")
    .update(JSON.stringify(failures))
    .digest("hex");
  const state = readState();
  if (state && state.hash === hash && Date.now() - state.at < COOLDOWN_MS) {
    console.log("[alerts] same failure set within cooldown; skipping webhook");
    return;
  }

  const message = `CSQ alert: ${failures
    .map((f) => `${f.service}: ${f.error}`)
    .join("; ")}`;
  try {
    const res = await fetch(WEBHOOK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: message, content: message, failures }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      console.error(`[alerts] webhook failed: HTTP ${res.status}`);
      return;
    }
    writeState({ hash, at: Date.now() });
    console.log("[alerts] webhook sent");
  } catch (err) {
    console.error("[alerts] webhook failed:", err);
  }
}

main()
  .catch((err: unknown) => {
    console.error("[alerts] check failed:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
