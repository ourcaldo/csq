import { useEffect, useState } from "react";
import type { GetServerSideProps } from "next";
import { useSession } from "next-auth/react";
import {
  WhatsappLogo,
  Cloud,
  PlugsConnected,
  QrCode,
  Warning,
  CheckCircle,
  PaperPlaneRight,
  Plug,
} from "@phosphor-icons/react";
import { QRCodeSVG } from "qrcode.react";
import { withAuth } from "@/lib/auth";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { BadgeStatus } from "@/components/dashboard/badge-status";
import { StateNotice } from "@/components/dashboard/state-notice";
import { LoadingSkeleton } from "@/components/dashboard/loading-skeleton";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Channels / WhatsApp onboarding page (gap B). Wires entirely to the existing
// channels backend: GET /api/dashboard/channels (list), POST .../connect,
// POST .../disconnect?id, POST .../test?id. Owner picks Cloud API (enter creds)
// or Baileys (acknowledge ToS → scan QR). The agent picker sets channel.agentId
// so runAgentReply doesn't stand down (agent-loop resolves via channel.agentId).
// ---------------------------------------------------------------------------

type ChannelView = {
  id: string;
  provider: "CLOUD_API" | "BAILEYS";
  type: "WHATSAPP";
  status: string;
  agentId: string | null;
  phoneNumberId?: string;
  tosAcknowledged?: boolean;
  createdAt: string;
  updatedAt: string;
};

type AgentItem = { id: string; name: string; status: string };

type ConnectResult = {
  channelId: string;
  provider: string;
  status: string;
  qr: string | null;
};

const EMPTY_CLOUD = {
  phoneNumberId: "",
  token: "",
  verifyToken: "demo-verify-token",
  appSecret: "",
  businessAccountId: "",
};

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

function statusTone(status: string): "green" | "neutral" {
  return status === "CONNECTED" ? "green" : "neutral";
}
function statusLabel(status: string): string {
  return status === "CONNECTED" ? "Terhubung" : "Terputus";
}

export default function SaluranPage() {
  const { data: session } = useSession();
  const isOwner = session?.user?.role === "OWNER";

  const { data: channelsData, loading, error: fetchError, refresh } =
    useApi<{ items: ChannelView[] }>("/api/dashboard/channels");
  const { data: agentsData } = useApi<{ items: AgentItem[] }>(
    "/api/dashboard/agents"
  );

  const channels = channelsData?.items ?? [];
  const cloud = channels.find((c) => c.provider === "CLOUD_API");
  const baileys = channels.find((c) => c.provider === "BAILEYS");

  const activeAgents = (agentsData?.items ?? []).filter(
    (a) => a.status === "ACTIVE"
  );

  const [agentId, setAgentId] = useState("");
  useEffect(() => {
    if (!agentId && activeAgents[0]) setAgentId(activeAgents[0].id);
  }, [activeAgents, agentId]);

  const [cloudForm, setCloudForm] = useState(EMPTY_CLOUD);
  // Prefill phoneNumberId once a connected Cloud channel loads.
  useEffect(() => {
    if (cloud?.phoneNumberId && !cloudForm.phoneNumberId) {
      setCloudForm((f) => ({ ...f, phoneNumberId: cloud.phoneNumberId! }));
    }
  }, [cloud?.phoneNumberId, cloudForm.phoneNumberId]);

  const [connecting, setConnecting] = useState<"" | "CLOUD_API" | "BAILEYS">("");
  const [baileysTos, setBaileysTos] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [testTo, setTestTo] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  // Poll the channel list while a Baileys QR is pending, so we detect the
  // socket opening (status → CONNECTED) without a manual refresh.
  useEffect(() => {
    if (!qr) return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [qr, refresh]);

  // Clear the QR once Baileys is connected.
  useEffect(() => {
    if (baileys?.status === "CONNECTED" && qr) setQr(null);
  }, [baileys?.status, qr]);

  async function connectCloud() {
    setConnecting("CLOUD_API");
    setPageError(null);
    try {
      await apiSend<ConnectResult>("/api/dashboard/channels/connect", "POST", {
        provider: "CLOUD_API",
        agentId: agentId || undefined,
        config: {
          phoneNumberId: cloudForm.phoneNumberId.trim(),
          token: cloudForm.token.trim(),
          verifyToken: cloudForm.verifyToken.trim() || undefined,
          appSecret: cloudForm.appSecret.trim() || undefined,
          businessAccountId: cloudForm.businessAccountId.trim() || undefined,
        },
      });
      setCloudForm((f) => ({ ...f, token: "", appSecret: "" }));
      refresh();
    } catch (e) {
      setPageError(errMsg(e, "Gagal menyambungkan Cloud API."));
    } finally {
      setConnecting("");
    }
  }

  async function connectBaileys() {
    setConnecting("BAILEYS");
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
      if (res.qr) setQr(res.qr);
      refresh();
    } catch (e) {
      setPageError(errMsg(e, "Gagal menyambungkan Baileys."));
    } finally {
      setConnecting("");
    }
  }

  async function disconnectChannel(id: string) {
    setPageError(null);
    try {
      await apiSend(`/api/dashboard/channels/disconnect?id=${id}`, "POST");
      refresh();
    } catch (e) {
      setPageError(errMsg(e, "Gagal memutus channel."));
    }
  }

  async function testChannel(id: string) {
    const to = (testTo[id] ?? "").trim();
    if (!to) return;
    setTesting(id);
    setTestResult((p) => ({ ...p, [id]: "" }));
    try {
      await apiSend(`/api/dashboard/channels/test?id=${id}`, "POST", { to });
      setTestResult((p) => ({ ...p, [id]: "Terkirim ✅" }));
    } catch (e) {
      setTestResult((p) => ({ ...p, [id]: errMsg(e, "Gagal.") }));
    } finally {
      setTesting(null);
    }
  }

  const inputCls =
    "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm placeholder-slate-400 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20";

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
      {fetchError && (
        <p className="mb-4 text-sm text-destructive">{fetchError}</p>
      )}

      {!isOwner && (
        <p className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700">
          Hanya owner yang dapat mengatur saluran. Anda melihat dalam mode
          baca-saja.
        </p>
      )}

      {loading && <LoadingSkeleton rows={2} />}

      {/* Agent picker — the channel must link to an ACTIVE agent or the AI
          auto-reply stands down (agent-loop resolves via channel.agentId). */}
      {!loading && activeAgents.length > 0 && (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-900">
                Agent yang Membalas
              </h2>
              <p className="mt-0.5 text-sm text-slate-500">
                Pesan masuk pada saluran ini akan dibalas oleh agent ini.
              </p>
            </div>
            <select
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              disabled={!isOwner}
              className={cn(inputCls, "md:w-72")}
            >
              {activeAgents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}

      {!loading && activeAgents.length === 0 && (
        <StateNotice
          variant="empty"
          message="Belum ada agent aktif. Deploy sebuah agent di halaman Agent sebelum menyambungkan saluran."
        />
      )}

      {!loading && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* ───────────── Cloud API ───────────── */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-600 text-white">
                  <Cloud size={20} weight="fill" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    WhatsApp Cloud API
                  </h2>
                  <p className="text-sm text-slate-500">
                    Resmi, aman ToS, jendela 24 jam.
                  </p>
                </div>
              </div>
              <BadgeStatus tone={statusTone(cloud?.status ?? "DISCONNECTED")}>
                {statusLabel(cloud?.status ?? "Terputus")}
              </BadgeStatus>
            </div>
            <Separator />
            <div className="space-y-3 p-5">
              <Field
                label="Phone Number ID"
                value={cloudForm.phoneNumberId}
                onChange={(v) => setCloudForm((f) => ({ ...f, phoneNumberId: v }))}
                placeholder="103xxxxxxxxxx"
                disabled={!isOwner}
              />
              <Field
                label="Access Token"
                value={cloudForm.token}
                onChange={(v) => setCloudForm((f) => ({ ...f, token: v }))}
                placeholder={
                  cloud?.status === "CONNECTED"
                    ? "••••••••  (masukkan ulang untuk menyimpan)"
                    : "EAAGxxxxxxxx..."
                }
                disabled={!isOwner}
                type="password"
              />
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field
                  label="Verify Token (webhook)"
                  value={cloudForm.verifyToken}
                  onChange={(v) =>
                    setCloudForm((f) => ({ ...f, verifyToken: v }))
                  }
                  placeholder="demo-verify-token"
                  disabled={!isOwner}
                />
                <Field
                  label="App Secret (opsional)"
                  value={cloudForm.appSecret}
                  onChange={(v) => setCloudForm((f) => ({ ...f, appSecret: v }))}
                  placeholder="xxx..."
                  disabled={!isOwner}
                  type="password"
                />
              </div>
              <Field
                label="Business Account ID (opsional)"
                value={cloudForm.businessAccountId}
                onChange={(v) =>
                  setCloudForm((f) => ({ ...f, businessAccountId: v }))
                }
                placeholder="10xxxx..."
                disabled={!isOwner}
              />

              <div className="flex items-center gap-2 pt-1">
                <Button
                  size="sm"
                  disabled={!isOwner || connecting === "CLOUD_API"}
                  onClick={connectCloud}
                >
                  <PlugsConnected size={16} />
                  {connecting === "CLOUD_API"
                    ? "Menyambungkan…"
                    : cloud?.status === "CONNECTED"
                    ? "Simpan"
                    : "Sambungkan"}
                </Button>
                {cloud?.status === "CONNECTED" && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!isOwner}
                    onClick={() => disconnectChannel(cloud.id)}
                  >
                    Putuskan
                  </Button>
                )}
              </div>

              {cloud?.status === "CONNECTED" && (
                <TestBox
                  id={cloud.id}
                  testTo={testTo}
                  testResult={testResult}
                  testing={testing}
                  onTo={(v) => setTestTo((p) => ({ ...p, [cloud.id]: v }))}
                  onTest={() => testChannel(cloud.id)}
                  disabled={!isOwner}
                />
              )}

              <p className="text-xs text-slate-400">
                Setel webhook di Meta App Manager ke{" "}
                <code className="rounded bg-slate-100 px-1">
                  https://csq-z821.onrender.com/api/webhooks/whatsapp
                </code>{" "}
                dengan verify token yang sama.
              </p>
            </div>
          </div>

          {/* ───────────── Baileys ───────────── */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-800 text-white">
                  <WhatsappLogo size={20} weight="fill" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    Baileys (Bawa Nomor Sendiri)
                  </h2>
                  <p className="text-sm text-slate-500">
                    Pindai QR, paritas penuh, tanpa template.
                  </p>
                </div>
              </div>
              <BadgeStatus tone={statusTone(baileys?.status ?? "DISCONNECTED")}>
                {statusLabel(baileys?.status ?? "Terputus")}
              </BadgeStatus>
            </div>
            <Separator />
            <div className="space-y-3 p-5">
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-800">
                <Warning size={18} weight="fill" className="mt-0.5 shrink-0" />
                <p>
                  Baileys menggunakan nomor pribadi dan berisiko dibanned oleh
                  WhatsApp. Owner wajib menyetujui risiko ini sebelum
                  mengaktifkan.
                </p>
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <Switch
                  checked={baileysTos}
                  disabled={!isOwner}
                  onChange={setBaileysTos}
                />
                Saya memahami dan menyetujui risiko ToS/banned.
              </label>

              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  disabled={!isOwner || !baileysTos || connecting === "BAILEYS"}
                  onClick={connectBaileys}
                >
                  <Plug size={16} />
                  {connecting === "BAILEYS"
                    ? "Memulai…"
                    : baileys?.status === "CONNECTED"
                    ? "Sambungkan Ulang"
                    : "Mulai & Tampilkan QR"}
                </Button>
                {baileys?.status === "CONNECTED" && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!isOwner}
                    onClick={() => disconnectChannel(baileys.id)}
                  >
                    Putuskan
                  </Button>
                )}
              </div>

              {qr && baileys?.status !== "CONNECTED" && (
                <div className="flex flex-col items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="rounded-lg bg-white p-3 shadow-sm">
                    <QRCodeSVG value={qr} size={200} level="M" />
                  </div>
                  <p className="flex items-center gap-1.5 text-sm text-slate-600">
                    <QrCode size={16} />
                    Pindai QR ini dari WhatsApp &gt; Tautkan perangkat. Status
                    diperbarui otomatis.
                  </p>
                </div>
              )}

              {baileys?.status === "CONNECTED" && (
                <TestBox
                  id={baileys.id}
                  testTo={testTo}
                  testResult={testResult}
                  testing={testing}
                  onTo={(v) => setTestTo((p) => ({ ...p, [baileys.id]: v }))}
                  onTest={() => testChannel(baileys.id)}
                  disabled={!isOwner}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}

// ─────────────────────────── Field + TestBox ───────────────────────────

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  type?: string;
}) {
  const inputCls =
    "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm placeholder-slate-400 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20";
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">
        {props.label}
      </span>
      <input
        type={props.type ?? "text"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        placeholder={props.placeholder}
        disabled={props.disabled}
        className={inputCls}
      />
    </label>
  );
}

function TestBox(props: {
  id: string;
  testTo: Record<string, string>;
  testResult: Record<string, string>;
  testing: string | null;
  onTo: (v: string) => void;
  onTest: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
        <CheckCircle size={14} /> Kirim Pesan Test
      </p>
      <div className="flex items-center gap-2">
        <input
          value={props.testTo[props.id] ?? ""}
          onChange={(e) => props.onTo(e.target.value)}
          placeholder="62812xxxxxxx"
          disabled={props.disabled}
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm placeholder-slate-400 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20"
        />
        <Button
          size="sm"
          variant="outline"
          disabled={props.disabled || props.testing === props.id}
          onClick={props.onTest}
        >
          <PaperPlaneRight size={16} />
          {props.testing === props.id ? "Mengirim…" : "Test"}
        </Button>
      </div>
      {props.testResult[props.id] && (
        <p className="mt-2 text-xs text-slate-600">
          {props.testResult[props.id]}
        </p>
      )}
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth<
  Record<string, unknown>
>(async () => ({ props: {} }));
