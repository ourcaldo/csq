import { useEffect, useRef, useState } from "react";
import type { GetServerSideProps } from "next";
import { useSession } from "next-auth/react";
import { Cloud, PlusCircle, WhatsappLogo } from "@phosphor-icons/react";
import { withAuth, getSSRSession } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { apiFetch, apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { StateNotice } from "@/components/dashboard/state-notice";
import { LoadingSkeleton } from "@/components/dashboard/loading-skeleton";
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

// Channels page (PRD 15 multi-channel): every channel of the tenant is listed
// as its own card; "Tambah saluran" starts the provider flow for a NEW
// channel. Single-channel tenants see the same list with one card - no
// behavioral change for them beyond the label.

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
  const activeAgents = (agentsData?.items ?? []).filter(
    (a) => a.status === "ACTIVE"
  );

  // Add-flow state; null = list view, otherwise the provider choice is done
  // and the form is showing. Per-channel edit state is separate.
  const [adding, setAdding] = useState<Provider | null>(null);
  const [editing, setEditing] = useState<ChannelView | null>(null);

  const [agentId, setAgentId] = useState("");
  useEffect(() => {
    if (!agentId && activeAgents[0]) setAgentId(activeAgents[0].id);
  }, [activeAgents, agentId]);

  const [cloudForm, setCloudForm] = useState<CloudForm>(EMPTY_CLOUD);
  const [byoLabel, setByoLabel] = useState("");
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
          setAdding(null);
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

  const qrStale =
    qrAt !== null && Date.now() - qrAt > 60_000;

  function openAdd(p: Provider) {
    setAdding(p);
    setEditing(null);
    setPageError(null);
    setQr(null);
    setTos(false);
    setByoLabel("");
  }

  function openEdit(channel: ChannelView) {
    setEditing(channel);
    setAdding(null);
    setCloudForm({
      label: channel.label,
      phoneNumberId: channel.phoneNumberId ?? channel.externalId ?? "",
      token: "",
      appSecret: "",
      businessAccountId: "",
    });
  }

  async function connectCloud() {
    setConnecting(true);
    setPageError(null);
    try {
      await apiSend<ConnectResult>("/api/dashboard/channels/connect", "POST", {
        provider: "CLOUD_API",
        ...(editing ? { channelId: editing.id } : {}),
        label: cloudForm.label.trim(),
        agentId: agentId || undefined,
        config: {
          phoneNumberId: cloudForm.phoneNumberId.trim(),
          token: cloudForm.token.trim(),
          appSecret: cloudForm.appSecret.trim() || undefined,
          businessAccountId: cloudForm.businessAccountId.trim() || undefined,
        },
      });
      setCloudForm(EMPTY_CLOUD);
      setAdding(null);
      setEditing(null);
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
          label: byoLabel.trim(),
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
      setAdding(null);
      setEditing(null);
      refresh();
    } catch (e) {
      setPageError(errMsg(e, "Gagal memutus saluran."));
    }
  }

  async function archiveChannel(id: string) {
    setPageError(null);
    try {
      await apiSend(`/api/dashboard/channels/archive?id=${id}`, "POST");
      setAdding(null);
      setEditing(null);
      refresh();
      showToast("Saluran diarsipkan. Data percakapan tetap tersimpan.", "success");
    } catch (e) {
      setPageError(errMsg(e, "Gagal mengarsipkan saluran."));
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
      description="Sambungkan satu atau lebih nomor WhatsApp untuk mengirim dan menerima pesan dari pelanggan."
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

      {loading && <LoadingSkeleton rows={2} />}

      {!loading && channels.length === 0 && activeAgents.length === 0 && !adding && (
        <StateNotice
          variant="empty"
          message="Belum ada agent aktif. Deploy sebuah agent di halaman Agent sebelum menyambungkan saluran."
        />
      )}

      {/* Channel list (PRD 15): one card per channel. */}
      {!loading &&
        channels.map((c) => (
          <div key={c.id} className="mb-4">
            <ConnectedChannelCard
              channel={c}
              webhookUrl={webhookUrl}
              cloudVerifyToken={cloudVerifyToken}
              isOwner={isOwner}
              onEdit={() => openEdit(c)}
              onDisconnect={() => void disconnectChannel(c.id)}
              onArchive={() => void archiveChannel(c.id)}
              testTo={testTo}
              testing={testing}
              onTestTo={(v) => setTestTo((p) => ({ ...p, [c.id]: v }))}
              onTest={() => void testChannel(c.id)}
            />
          </div>
        ))}

      {/* Add flow step 1: provider choice. */}
      {!loading && !adding && (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <MethodCard
            icon={<Cloud size={22} weight="fill" />}
            tone="green"
            title="Tambah Nomor Resmi"
            subtitle="Via Meta Cloud API"
            points={[
              "Resmi & patuh ToS WhatsApp",
              "Cocok untuk nomor bisnis",
              "Memerlukan kredensial dari Meta App Manager",
            ]}
            ctaLabel="Pilih WhatsApp Resmi"
            disabled={!isOwner || activeAgents.length === 0}
            onChoose={() => openAdd("CLOUD_API")}
          />
          <MethodCard
            icon={<WhatsappLogo size={22} weight="fill" />}
            tone="slate"
            title="Tambah Nomor Pribadi"
            subtitle="Pindai QR dari aplikasi WhatsApp"
            points={[
              "Aktif dalam hitungan menit",
              "Tanpa pengaturan Meta",
              "Gunakan nomor WhatsApp Anda yang sudah aktif",
            ]}
            ctaLabel="Pilih Bawa Nomor Sendiri"
            disabled={!isOwner || activeAgents.length === 0}
            onChoose={() => openAdd("BAILEYS")}
          />
        </div>
      )}

      {!loading && channels.length > 0 && !adding && (
        <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-400">
          <PlusCircle size={14} />
          Tambahkan nomor lain kapan saja - setiap saluran punya percakapan dan
          agent-nya sendiri.
        </p>
      )}

      {/* Add flow step 2: Cloud API form. */}
      {!loading && adding === "CLOUD_API" && (
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
          onBack={() => setAdding(null)}
          onSubmit={() => void connectCloud()}
        />
      )}

      {/* Add flow step 2: Baileys QR. */}
      {!loading && adding === "BAILEYS" && (
        <BaileysForm
          agents={activeAgents}
          agentId={agentId}
          onAgentChange={setAgentId}
          label={byoLabel}
          onLabelChange={setByoLabel}
          tos={tos}
          onTosChange={setTos}
          connecting={connecting}
          isOwner={isOwner}
          qr={qr}
          qrStale={qrStale}
          onBack={() => setAdding(null)}
          onConnect={() => void connectByo()}
        />
      )}

      {/* Per-channel credential edit. */}
      {!loading && editing && editing.provider === "CLOUD_API" && (
        <CloudApiEditForm
          form={cloudForm}
          onChange={setCloud}
          connecting={connecting}
          isOwner={isOwner}
          onBack={() => setEditing(null)}
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

  // PRD 15: the verify token is app-level (WHATSAPP_VERIFY_TOKEN on the api
  // service). The legacy per-channel token is still displayed as a fallback
  // during the transition; if neither exists, generate a value only so the
  // owner has SOMETHING to paste - but prefer the env token, which is what
  // the webhook actually verifies now.
  const session = await getSSRSession(ctx);
  let cloudVerifyToken: string | null =
    process.env.WHATSAPP_VERIFY_TOKEN ?? null;
  if (session?.user.tenantId && !cloudVerifyToken) {
    const tenantId = session.user.tenantId;
    // RLS context (PRD 16 SEC-1): the Channel read below is this tenant's.
    await withTenantContext(tenantId, async () => {
      const existing = await prisma.channel.findFirst({
        where: { tenantId, provider: "CLOUD_API" },
      });
      const parsedConfig = existing?.config;
      const rawConfig =
        parsedConfig && typeof parsedConfig === "object" && "verifyToken" in parsedConfig
          ? parsedConfig
          : {};
      const existingToken =
        "verifyToken" in rawConfig && typeof rawConfig.verifyToken === "string"
          ? rawConfig.verifyToken
          : undefined;
      cloudVerifyToken = existingToken ?? null;
    });
  }

  return { props: { webhookUrl, cloudVerifyToken } };
  // SEC-3 (PRD 16): channel configuration is OWNER-only (PRD 15.9).
}, { requiredRole: "OWNER" });
