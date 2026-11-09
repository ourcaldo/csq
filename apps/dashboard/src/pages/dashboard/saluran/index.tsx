import { useEffect, useRef, useState } from "react";
import type { GetServerSideProps } from "next";
import { useSession } from "next-auth/react";
import { Check, Cloud, WhatsappLogo } from "@phosphor-icons/react";
import { withAuth, getSSRSession } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { cloudApiConfigSchema } from "@csq/core/types/whatsapp";
import { generateVerifyToken } from "@csq/core/lib/whatsapp-verify-token";
import { z } from "zod";
import { apiFetch, apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { StateNotice } from "@/components/dashboard/state-notice";
import { LoadingSkeleton } from "@/components/dashboard/loading-skeleton";
import { cn } from "@csq/ui/lib/utils";
import { MethodCard } from "@/components/dashboard/channels/method-card";
import { ConnectedChannelCard } from "@/components/dashboard/channels/connected-channel-card";
import { CloudApiForm } from "@/components/dashboard/channels/cloud-api-form";
import { BaileysForm } from "@/components/dashboard/channels/baileys-form";
import { CloudApiEditForm } from "@/components/dashboard/channels/cloud-api-edit-form";
import { Toast } from "@/components/dashboard/channels/toast";
import {
  EMPTY_CLOUD,
  type AgentItem,
  type ChannelView,
  type CloudForm,
  type ConnectResult,
  type Provider,
  type ToastState,
} from "@/components/dashboard/channels/types";

// Channels / WhatsApp onboarding page (gap B). The wizard state lives here;
// the method cards, forms and connected card are separate components under
// components/dashboard/channels/ (PRD 09 page-splitting).
const STEPS = ["Pilih Metode", "Sambungkan", "Aktif"];

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

export default function SaluranPage({
  webhookUrl,
  cloudVerifyToken,
}: SaluranProps) {
  const { data: session } = useSession();
  const isOwner = session?.user?.role === "OWNER";

  const { data: channelsData, loading, error: fetchError, refresh } =
    useApi<{ items: ChannelView[] }>("/api/dashboard/channels");
  const { data: agentsData } = useApi<{ items: AgentItem[] }>(
    "/api/dashboard/agents"
  );

  const channels = channelsData?.items ?? [];
  const connected = channels.find((c) => c.status === "CONNECTED") ?? null;
  const cloud = channels.find((c) => c.provider === "CLOUD_API");
  const baileys = channels.find((c) => c.provider === "BAILEYS");

  const activeAgents = (agentsData?.items ?? []).filter(
    (a) => a.status === "ACTIVE"
  );

  const [step, setStep] = useState<1 | 2>(1);
  const [method, setMethod] = useState<Provider | null>(null);
  const [editCreds, setEditCreds] = useState(false);

  const [agentId, setAgentId] = useState("");
  useEffect(() => {
    if (!agentId && activeAgents[0]) setAgentId(activeAgents[0].id);
  }, [activeAgents, agentId]);

  const [cloudForm, setCloudForm] = useState<CloudForm>(EMPTY_CLOUD);
  useEffect(() => {
    if (cloud?.phoneNumberId && !cloudForm.phoneNumberId) {
      setCloudForm((f) => ({ ...f, phoneNumberId: cloud.phoneNumberId ?? "" }));
    }
  }, [cloud?.phoneNumberId, cloudForm.phoneNumberId]);

  function setCloud(patch: Partial<CloudForm>) {
    setCloudForm((f) => ({ ...f, ...patch }));
  }

  const [connecting, setConnecting] = useState(false);
  const [tos, setTos] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [qrAt, setQrAt] = useState<number | null>(null);
  const [byoChannelId, setByoChannelId] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const deadPolls = useRef(0);
  const [testTo, setTestTo] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(msg: string, tone: "success" | "error") {
    setToast({ msg, tone });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }

  // Poll the LIVE QR + open state while a Baileys QR is pending. Baileys
  // rotates the QR periodically, so display the current one and detect when
  // the scan completes.
  useEffect(() => {
    if (!byoChannelId || !qr) return;
    let active = true;
    const tick = async () => {
      try {
        const state = await apiFetch<{ qr: string | null; open: boolean }>(
          `/api/dashboard/channels/${byoChannelId}/qr`
        );
        if (!active) return;
        if (state.open) {
          deadPolls.current = 0;
          setQr(null);
          setQrAt(null);
          refresh();
        } else if (state.qr) {
          deadPolls.current = 0;
          setQr(state.qr);
          setQrAt((prev) => prev ?? Date.now());
        } else if (++deadPolls.current >= 2) {
          deadPolls.current = 0;
          setQr(null);
          setQrAt(null);
          setPageError("Sesi QR berakhir. Klik Tampilkan QR untuk memulai ulang.");
        }
      } catch {
        /* ignore transient poll errors */
      }
    };
    void tick();
    const t = setInterval(tick, 3000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [byoChannelId, qr, refresh]);

  useEffect(() => {
    if (baileys?.status === "CONNECTED" && qr) {
      setQr(null);
      setQrAt(null);
    }
  }, [baileys?.status, qr]);

  const currentStep = connected && !editCreds ? 3 : step;
  const qrStale =
    qrAt !== null &&
    baileys?.status !== "CONNECTED" &&
    Date.now() - qrAt > 60_000;

  function chooseMethod(p: Provider) {
    setMethod(p);
    setStep(2);
    setPageError(null);
    setQr(null);
  }

  async function connectCloud() {
    setConnecting(true);
    setPageError(null);
    try {
      await apiSend<ConnectResult>("/api/dashboard/channels/connect", "POST", {
        provider: "CLOUD_API",
        agentId: agentId || undefined,
        config: {
          phoneNumberId: cloudForm.phoneNumberId.trim(),
          token: cloudForm.token.trim(),
          appSecret: cloudForm.appSecret.trim() || undefined,
          businessAccountId: cloudForm.businessAccountId.trim() || undefined,
        },
      });
      setCloudForm((f) => ({ ...f, token: "", appSecret: "" }));
      setEditCreds(false);
      refresh();
    } catch (e) {
      setPageError(errMsg(e, "Gagal menyambungkan."));
    } finally {
      setConnecting(false);
    }
  }

  async function connectByo() {
    setConnecting(true);
    setPageError(null);
    setQr(null);
    try {
      const res = await apiSend<ConnectResult>(
        "/api/dashboard/channels/connect",
        "POST",
        {
          provider: "BAILEYS",
          agentId: agentId || undefined,
          config: { tosAcknowledged: true },
        }
      );
      if (res.qr) {
        setQr(res.qr);
        setQrAt(Date.now());
      }
      setByoChannelId(res.channelId);
      refresh();
    } catch (e) {
      setPageError(errMsg(e, "Gagal memulai sambungan."));
    } finally {
      setConnecting(false);
    }
  }

  async function disconnectChannel(id: string) {
    setPageError(null);
    try {
      await apiSend(`/api/dashboard/channels/disconnect?id=${id}`, "POST");
      setEditCreds(false);
      setStep(1);
      setMethod(null);
      refresh();
    } catch (e) {
      setPageError(errMsg(e, "Gagal memutus saluran."));
    }
  }

  async function testChannel(id: string) {
    const to = (testTo[id] ?? "").trim();
    if (!to) return;
    setTesting(id);
    try {
      await apiSend(`/api/dashboard/channels/test?id=${id}`, "POST", { to });
      showToast("Pesan test terkirim.", "success");
      setTestTo((p) => ({ ...p, [id]: "" }));
    } catch (e) {
      showToast(errMsg(e, "Pesan test gagal terkirim."), "error");
    } finally {
      setTesting(null);
    }
  }

  return (
    <DashboardShell
      title="Saluran"
      description="Sambungkan WhatsApp untuk mengirim dan menerima pesan dari pelanggan."
    >
      {pageError && (
        <p className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700">
          {pageError}
        </p>
      )}
      {fetchError && <p className="mb-4 text-sm text-destructive">{fetchError}</p>}

      {!isOwner && (
        <p className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700">
          Hanya owner yang dapat mengatur saluran. Anda melihat dalam mode
          baca-saja.
        </p>
      )}

      {!loading && (
        <div className="mb-6 flex items-center gap-1 overflow-x-auto">
          {STEPS.map((label, i) => {
            const n = i + 1;
            const done = currentStep > n;
            const active = currentStep === n;
            return (
              <div key={label} className="flex shrink-0 items-center">
                <div className="flex items-center gap-2">
                  <div
                    className={cn(
                      "flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold",
                      active
                        ? "bg-green-600 text-white"
                        : done
                          ? "bg-green-100 text-green-700"
                          : "bg-slate-100 text-slate-400"
                    )}
                  >
                    {done ? <Check size={14} weight="bold" /> : n}
                  </div>
                  <span
                    className={cn(
                      "text-sm",
                      active ? "font-semibold text-slate-900" : "text-slate-500"
                    )}
                  >
                    {label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div
                    className={cn(
                      "mx-2 h-px w-6 shrink-0 sm:w-12",
                      done ? "bg-green-300" : "bg-slate-200"
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}

      {loading && <LoadingSkeleton rows={2} />}

      {!loading && activeAgents.length === 0 && !connected && (
        <StateNotice
          variant="empty"
          message="Belum ada agent aktif. Deploy sebuah agent di halaman Agent sebelum menyambungkan saluran."
        />
      )}

      {!loading && connected && !editCreds && (
        <ConnectedChannelCard
          channel={connected}
          webhookUrl={webhookUrl}
          cloudVerifyToken={cloudVerifyToken}
          isOwner={isOwner}
          onEdit={() => {
            setMethod("CLOUD_API");
            setStep(2);
            setEditCreds(true);
          }}
          onDisconnect={() => void disconnectChannel(connected.id)}
          testTo={testTo}
          testing={testing}
          onTestTo={(v) => setTestTo((p) => ({ ...p, [connected.id]: v }))}
          onTest={() => void testChannel(connected.id)}
        />
      )}

      {!loading && !connected && step === 1 && (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <MethodCard
            icon={<Cloud size={22} weight="fill" />}
            tone="green"
            title="WhatsApp Resmi"
            subtitle="Via Meta Cloud API"
            points={[
              "Resmi & patuh ToS WhatsApp",
              "Cocok untuk nomor bisnis",
              "Memerlukan kredensial dari Meta App Manager",
            ]}
            ctaLabel="Pilih WhatsApp Resmi"
            disabled={!isOwner || activeAgents.length === 0}
            onChoose={() => chooseMethod("CLOUD_API")}
          />
          <MethodCard
            icon={<WhatsappLogo size={22} weight="fill" />}
            tone="slate"
            title="Bawa Nomor Sendiri"
            subtitle="Pindai QR dari aplikasi WhatsApp"
            points={[
              "Aktif dalam hitungan menit",
              "Tanpa pengaturan Meta",
              "Gunakan nomor WhatsApp Anda yang sudah aktif",
            ]}
            ctaLabel="Pilih Bawa Nomor Sendiri"
            disabled={!isOwner || activeAgents.length === 0}
            onChoose={() => chooseMethod("BAILEYS")}
          />
        </div>
      )}

      {!loading && !connected && step === 2 && method === "CLOUD_API" && (
        <CloudApiForm
          form={cloudForm}
          onChange={setCloud}
          agents={activeAgents}
          agentId={agentId}
          onAgentChange={setAgentId}
          webhookUrl={webhookUrl}
          cloudVerifyToken={cloudVerifyToken}
          connecting={connecting}
          isOwner={isOwner}
          onBack={() => setStep(1)}
          onSubmit={() => void connectCloud()}
        />
      )}

      {!loading && !connected && step === 2 && method === "BAILEYS" && (
        <BaileysForm
          agents={activeAgents}
          agentId={agentId}
          onAgentChange={setAgentId}
          tos={tos}
          onTosChange={setTos}
          connecting={connecting}
          isOwner={isOwner}
          qr={qr}
          qrStale={qrStale}
          onBack={() => setStep(1)}
          onConnect={() => void connectByo()}
        />
      )}

      {!loading && connected && editCreds && method === "CLOUD_API" && (
        <CloudApiEditForm
          form={cloudForm}
          onChange={setCloud}
          connecting={connecting}
          isOwner={isOwner}
          onBack={() => setEditCreds(false)}
          onSubmit={() => void connectCloud()}
        />
      )}

      <Toast toast={toast} />
    </DashboardShell>
  );
}

type SaluranProps = {
  webhookUrl: string;
  cloudVerifyToken: string | null;
};

export const getServerSideProps: GetServerSideProps<SaluranProps> = withAuth<
  SaluranProps
>(async (ctx) => {
  // Webhook URL shown in the UI: the webhook lives in apps/api (Phase 7), so
  // its URL comes from API_URL; the request-origin fallback only serves dev.
  const apiBase = (process.env.API_URL ?? "").replace(/\/$/, "");
  const fallback = (
    process.env.NEXTAUTH_URL ?? `https://${ctx.req.headers.host}`
  ).replace(/\/$/, "");
  const webhookUrl = `${apiBase || fallback}/api/webhooks/whatsapp`;

  // Verify token is sanitized out of the channels list API (secret-adjacent).
  // The Cloud API channel row carries the token; if none exists yet (first
  // connect) or the stored one is missing or still the old predictable default
  // ("demo-verify-token"), create/persist a freshly generated token NOW - so
  // the token is on screen before the owner clicks Sambungkan, and Meta's
  // webhook Verify can succeed immediately.
  const session = await getSSRSession(ctx);
  let cloudVerifyToken: string | null = null;
  if (session?.user.tenantId) {
    const tenantId = session.user.tenantId;
    // RLS context (PRD 16 SEC-1): the Channel reads/writes below are this
    // tenant's rows.
    await withTenantContext(tenantId, async () => {
      const existing = await prisma.channel.findFirst({
        where: { tenantId, provider: "CLOUD_API" },
      });
      const parsed = cloudApiConfigSchema.safeParse(existing?.config);
      const existingToken = parsed.success ? parsed.data.verifyToken : undefined;
      const isWeakToken = !existingToken || existingToken === "demo-verify-token";
      if (existingToken && !isWeakToken) {
        cloudVerifyToken = existingToken;
      } else if (existing) {
        // Channel exists but has no token (or still the pre-rotation default) -
        // write a fresh one.
        const rawConfig = z.record(z.unknown()).safeParse(existing.config);
        const merged = {
          ...(rawConfig.success ? rawConfig.data : {}),
          verifyToken: generateVerifyToken(),
        };
        await prisma.channel.update({
          where: { id: existing.id },
          data: { config: merged },
        });
        cloudVerifyToken = merged.verifyToken;
      } else {
        // No channel row yet: create the stub now (DISCONNECTED, no secrets)
        // so a verified webhook + on-screen token exist before Sambungkan.
        const token = generateVerifyToken();
        await prisma.channel.create({
          data: {
            tenantId,
            type: "WHATSAPP",
            provider: "CLOUD_API",
            status: "DISCONNECTED",
            config: { verifyToken: token },
          },
        });
        cloudVerifyToken = token;
      }
    });
  }

  return { props: { webhookUrl, cloudVerifyToken } };
});
