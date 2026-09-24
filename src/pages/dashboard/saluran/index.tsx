import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { GetServerSideProps } from "next";
import { useSession } from "next-auth/react";
import {
  WhatsappLogo,
  Cloud,
  PlugsConnected,
  QrCode,
  Check,
  CheckCircle,
  WarningCircle,
  PaperPlaneRight,
  ArrowLeft,
  Plug,
} from "@phosphor-icons/react";
import { QRCodeSVG } from "qrcode.react";
import { withAuth, getSSRSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { cloudApiConfigSchema } from "@/types/whatsapp";
import { generateVerifyToken } from "@/lib/whatsapp-verify-token";
import { z } from "zod";
import { apiFetch, apiSend } from "@/lib/api-client";
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
// Channels / WhatsApp onboarding page (gap B). Step-by-step wizard:
//   1. Pilih Metode  — pick how to connect (white-labeled; no provider names)
//   2. Sambungkan    — configure the chosen method (creds, or scan QR)
//   3. Aktif         — connected: test / disconnect / edit credentials
// Wires to the existing channels backend (connect / disconnect / test / list).
// The channel must link to an ACTIVE agent or runAgentReply stands down.
// ---------------------------------------------------------------------------

type Provider = "CLOUD_API" | "BAILEYS";

type ChannelView = {
  id: string;
  provider: Provider;
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

const STEPS = ["Pilih Metode", "Sambungkan", "Aktif"];

const EMPTY_CLOUD = {
  phoneNumberId: "",
  token: "",
  appSecret: "",
  businessAccountId: "",
};

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm placeholder-slate-400 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20";

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

  const [cloudForm, setCloudForm] = useState(EMPTY_CLOUD);
  useEffect(() => {
    if (cloud?.phoneNumberId && !cloudForm.phoneNumberId) {
      setCloudForm((f) => ({ ...f, phoneNumberId: cloud.phoneNumberId! }));
    }
  }, [cloud?.phoneNumberId, cloudForm.phoneNumberId]);

  const [connecting, setConnecting] = useState(false);
  const [tos, setTos] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [qrAt, setQrAt] = useState<number | null>(null);
  const [byoChannelId, setByoChannelId] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [testTo, setTestTo] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    msg: string;
    tone: "success" | "error";
  } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(msg: string, tone: "success" | "error") {
    setToast({ msg, tone });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  }

  // Poll the LIVE QR + open state while a Baileys QR is pending. Baileys
  // rotates the QR periodically, so we must display the *current* one (not
  // the QR from the initial connect call) and detect when the scan completes.
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
          setQr(null);
          setQrAt(null);
          refresh();
        } else if (state.qr) {
          setQr(state.qr);
          setQrAt((prev) => prev ?? Date.now());
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

  // The wizard's effective step (3 once connected & not editing creds).
  const currentStep = connected && !editCreds ? 3 : step;

  // Show a retry hint if the QR has been sitting for >60s without a connection.
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
      {fetchError && (
        <p className="mb-4 text-sm text-destructive">{fetchError}</p>
      )}

      {!isOwner && (
        <p className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700">
          Hanya owner yang dapat mengatur saluran. Anda melihat dalam mode
          baca-saja.
        </p>
      )}

      {/* Stepper */}
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
                      active
                        ? "font-semibold text-slate-900"
                        : "text-slate-500"
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

      {/* ───────────── Step 3: Aktif ───────────── */}
      {!loading && connected && !editCreds && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex flex-col gap-3 p-5 md:flex-row md:items-start md:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-600 text-white">
                {connected.provider === "CLOUD_API" ? (
                  <Cloud size={20} weight="fill" />
                ) : (
                  <WhatsappLogo size={20} weight="fill" />
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h2 className="text-base font-semibold text-slate-900">
                    {connected.provider === "CLOUD_API"
                      ? "WhatsApp Resmi"
                      : "Bawa Nomor Sendiri"}
                  </h2>
                  <BadgeStatus tone="green">Terhubung</BadgeStatus>
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {connected.provider === "CLOUD_API"
                    ? `Phone Number ID: ${connected.phoneNumberId ?? "—"}`
                    : "Terhubung via pindaian QR."}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {connected.provider === "CLOUD_API" && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!isOwner}
                  onClick={() => {
                    setMethod("CLOUD_API");
                    setEditCreds(true);
                  }}
                >
                  Edit Kredensial
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                disabled={!isOwner}
                onClick={() => disconnectChannel(connected.id)}
              >
                Putuskan
              </Button>
            </div>
          </div>
          <p className="px-5 pb-4 text-xs text-slate-400">
            Ingin berganti metode? Putuskan saluran ini, lalu pilih metode lain
            (mis. WhatsApp Resmi) dari langkah pertama.
          </p>
          {connected.provider === "CLOUD_API" && (
            <div className="space-y-3 px-5 pb-5">
              <Separator />
              <p className="pt-4 text-xs font-medium text-slate-600">
                Setelan webhook di Meta App Manager (WhatsApp → Configuration):
              </p>
              <ReadOnlyField label="Callback URL" value={webhookUrl} />
              <ReadOnlyField
                label="Verify Token"
                value={cloudVerifyToken ?? "—"}
                hint="Berganti otomatis setiap kali saluran disambungkan ulang — perbarui juga di Meta."
              />
            </div>
          )}
          <Separator />
          <div className="p-5">
            <TestBox
              id={connected.id}
              testTo={testTo}
              testing={testing}
              onTo={(v) =>
                setTestTo((p) => ({ ...p, [connected.id]: v }))
              }
              onTest={() => testChannel(connected.id)}
              disabled={!isOwner}
            />
          </div>
        </div>
      )}

      {/* ───────────── Step 1: Pilih Metode ───────────── */}
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

      {/* ───────────── Step 2: Sambungkan ───────────── */}
      {!loading && !connected && step === 2 && method === "CLOUD_API" && (
        <ConfigureCard
          title="WhatsApp Resmi"
          icon={<Cloud size={20} weight="fill" />}
          onBack={() => setStep(1)}
        >
          <div className="space-y-3">
            <Field
              label="Phone Number ID"
              value={cloudForm.phoneNumberId}
              onChange={(v) => setCloudForm((f) => ({ ...f, phoneNumberId: v }))}
              hint="Contoh: 103xxxxxxxxxx"
              disabled={!isOwner}
            />
            <Field
              label="Access Token"
              value={cloudForm.token}
              onChange={(v) => setCloudForm((f) => ({ ...f, token: v }))}
              hint="Token akses Meta Graph API, diawali EAAG…"
              disabled={!isOwner}
              type="password"
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label="App Secret"
                value={cloudForm.appSecret}
                onChange={(v) => setCloudForm((f) => ({ ...f, appSecret: v }))}
                hint="App Secret dari Meta App Manager"
                disabled={!isOwner}
                type="password"
              />
              <Field
                label="Business Account ID (opsional)"
                value={cloudForm.businessAccountId}
                onChange={(v) =>
                  setCloudForm((f) => ({ ...f, businessAccountId: v }))
                }
                hint="Opsional. Contoh: 10xxxx…"
                disabled={!isOwner}
              />
            </div>

            {/* Webhook setup comes BEFORE Sambungkan: Meta must verify the
                callback, and the owner needs URL + token on screen while doing
                the Meta-side config. Verify token is generated server-side on
                connect — shown here as it will be after Sambungkan. */}
            <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
              <p className="text-xs font-medium text-slate-600">
                Setel webhook di Meta App Manager (WhatsApp → Configuration)
                dengan nilai berikut, lalu klik Sambungkan dan tekan Verify di
                Meta:
              </p>
              <ReadOnlyField label="Callback URL" value={webhookUrl} />
              <ReadOnlyField
                label="Verify Token"
                value={cloudVerifyToken ?? "—"}
                hint="Token saat ini. Berganti otomatis setiap kali disambungkan ulang — salin nilai terbaru dari kartu saluran setelah Sambungkan."
              />
            </div>

            <AgentPicker
              agents={activeAgents}
              value={agentId}
              onChange={setAgentId}
              disabled={!isOwner}
            />

            <div className="pt-1">
              <Button
                disabled={!isOwner || connecting}
                onClick={connectCloud}
              >
                <PlugsConnected size={16} />
                {connecting ? "Menyambungkan…" : "Sambungkan"}
              </Button>
            </div>
          </div>
        </ConfigureCard>
      )}

      {!loading && !connected && step === 2 && method === "BAILEYS" && (
        <ConfigureCard
          title="Bawa Nomor Sendiri"
          icon={<WhatsappLogo size={20} weight="fill" />}
          onBack={() => setStep(1)}
        >
          <div className="space-y-4">
            <AgentPicker
              agents={activeAgents}
              value={agentId}
              onChange={setAgentId}
              disabled={!isOwner}
            />

            <label className="flex items-center gap-2 text-sm text-slate-700">
              <Switch checked={tos} disabled={!isOwner} onChange={setTos} />
              Saya menyetujui ketentuan layanan untuk penggunaan nomor pribadi.
            </label>

            <div className="flex items-center gap-2">
              <Button
                disabled={!isOwner || !tos || connecting}
                onClick={connectByo}
              >
                <Plug size={16} />
                {connecting ? "Memulai…" : "Tampilkan QR"}
              </Button>
            </div>

            {qr && (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="rounded-lg bg-white p-3 shadow-sm">
                  <QRCodeSVG value={qr} size={200} level="M" />
                </div>
                <p className="flex items-center gap-1.5 text-sm text-slate-600">
                  <QrCode size={16} />
                  Buka WhatsApp &gt; Tautkan perangkat, lalu pindai QR ini.
                  Status diperbarui otomatis.
                </p>
                {qrStale && (
                  <div className="mt-1 flex flex-col items-center gap-2">
                    <p className="text-center text-xs text-amber-700">
                      Scan belum terdeteksi setelah 1 menit. Pastikan telepon
                      tersambung internet, lalu coba lagi.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={connecting || !tos}
                      onClick={connectByo}
                    >
                      <Plug size={16} />
                      Coba Lagi
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        </ConfigureCard>
      )}

      {/* Edit credentials for an already-connected Cloud channel */}
      {!loading && connected && editCreds && method === "CLOUD_API" && (
        <ConfigureCard
          title="Edit Kredensial"
          icon={<Cloud size={20} weight="fill" />}
          onBack={() => setEditCreds(false)}
        >
          <div className="space-y-3">
            <Field
              label="Phone Number ID"
              value={cloudForm.phoneNumberId}
              onChange={(v) => setCloudForm((f) => ({ ...f, phoneNumberId: v }))}
              hint="Contoh: 103xxxxxxxxxx"
              disabled={!isOwner}
            />
            <Field
              label="Access Token"
              value={cloudForm.token}
              onChange={(v) => setCloudForm((f) => ({ ...f, token: v }))}
              hint="Masukkan ulang token akses Meta Graph API"
              disabled={!isOwner}
              type="password"
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field
                label="App Secret"
                value={cloudForm.appSecret}
                onChange={(v) => setCloudForm((f) => ({ ...f, appSecret: v }))}
                hint="Masukkan ulang App Secret dari Meta App Manager"
                disabled={!isOwner}
                type="password"
              />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button disabled={!isOwner || connecting} onClick={connectCloud}>
                <PlugsConnected size={16} />
                {connecting ? "Menyimpan…" : "Simpan"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setEditCreds(false)}
                disabled={connecting}
              >
                Batal
              </Button>
            </div>
            <p className="text-xs text-slate-400">
              Menyimpan membuat verify token baru — perbarui token webhook di
              Meta App Manager setelahnya.
            </p>
          </div>
        </ConfigureCard>
      )}

      <Toast toast={toast} />
    </DashboardShell>
  );
}

// ─────────────────────────── Subcomponents ───────────────────────────

function MethodCard(props: {
  icon: ReactNode;
  tone: "green" | "slate";
  title: string;
  subtitle: string;
  points: string[];
  ctaLabel: string;
  disabled?: boolean;
  onChoose: () => void;
}) {
  const iconWrap =
    props.tone === "green"
      ? "bg-green-600 text-white"
      : "bg-slate-800 text-white";
  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "flex h-11 w-11 items-center justify-center rounded-lg",
            iconWrap
          )}
        >
          {props.icon}
        </div>
        <div>
          <h3 className="text-base font-semibold text-slate-900">
            {props.title}
          </h3>
          <p className="text-sm text-slate-500">{props.subtitle}</p>
        </div>
      </div>
      <ul className="mt-4 flex-1 space-y-2">
        {props.points.map((p) => (
          <li
            key={p}
            className="flex items-start gap-2 text-sm text-slate-600"
          >
            <Check
              size={16}
              weight="bold"
              className="mt-0.5 shrink-0 text-green-600"
            />
            {p}
          </li>
        ))}
      </ul>
      <div className="mt-5">
        <Button
          className="w-full"
          disabled={props.disabled}
          onClick={props.onChoose}
        >
          {props.ctaLabel}
        </Button>
      </div>
    </div>
  );
}

function ConfigureCard(props: {
  title: string;
  icon: ReactNode;
  onBack: () => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center gap-3 p-5">
        <button
          onClick={props.onBack}
          className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
          aria-label="Kembali"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-600 text-white">
          {props.icon}
        </div>
        <h2 className="text-base font-semibold text-slate-900">
          {props.title}
        </h2>
      </div>
      <Separator />
      <div className="p-5">{props.children}</div>
    </div>
  );
}

function AgentPicker(props: {
  agents: AgentItem[];
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">
        Agent yang Membalas
      </span>
      <select
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        disabled={props.disabled}
        className={cn(inputCls, "md:w-72")}
      >
        {props.agents.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  disabled?: boolean;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">
        {props.label}
      </span>
      <input
        type={props.type ?? "text"}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        disabled={props.disabled}
        className={inputCls}
      />
      {props.hint && (
        <span className="mt-1 block text-xs text-slate-400">
          {props.hint}
        </span>
      )}
    </label>
  );
}

// Read-only credential display used for server-generated values (webhook URL,
// verify token): same height/padding as Field's input, with an inline copy
// button so it visually matches the editable fields beside it.
function ReadOnlyField(props: { label: string; value: string; hint?: string }) {
  return (
    <div className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">
        {props.label}
      </span>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          {props.value}
        </code>
        <button
          type="button"
          className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-green-700 hover:bg-green-50"
          onClick={() => {
            void navigator.clipboard.writeText(props.value);
          }}
        >
          Salin
        </button>
      </div>
      {props.hint && (
        <span className="mt-1 block text-xs text-slate-400">
          {props.hint}
        </span>
      )}
    </div>
  );
}

function TestBox(props: {
  id: string;
  testTo: Record<string, string>;
  testing: string | null;
  onTo: (v: string) => void;
  onTest: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
        <PaperPlaneRight size={14} /> Kirim Pesan Test
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          value={props.testTo[props.id] ?? ""}
          onChange={(e) => props.onTo(e.target.value)}
          disabled={props.disabled}
          className={cn(inputCls, "sm:flex-1")}
        />
        <Button
          size="sm"
          variant="outline"
          className="w-full sm:w-auto"
          disabled={props.disabled || props.testing === props.id}
          onClick={props.onTest}
        >
          {props.testing === props.id ? "Mengirim…" : "Test"}
        </Button>
      </div>
      <p className="mt-2 text-xs text-slate-400">
        Nomor tujuan format internasional, mis. 62812xxxxxxx
      </p>
    </div>
  );
}

function Toast({
  toast,
}: {
  toast: { msg: string; tone: "success" | "error" } | null;
}) {
  if (!toast) return null;
  return (
    <div
      className={cn(
        "fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg",
        toast.tone === "success" ? "bg-green-600" : "bg-red-600"
      )}
      role="status"
    >
      {toast.tone === "success" ? (
        <CheckCircle size={18} weight="fill" />
      ) : (
        <WarningCircle size={18} weight="fill" />
      )}
      {toast.msg}
    </div>
  );
}

type SaluranProps = {
  webhookUrl: string;
  cloudVerifyToken: string | null;
};

export const getServerSideProps: GetServerSideProps<SaluranProps> = withAuth<
  SaluranProps
>(async (ctx) => {
  // Webhook URL shown in the UI is derived from the request origin, so dev
  // shows localhost and prod shows the deployed domain (no hardcoded host).
  const origin = process.env.NEXTAUTH_URL ?? `https://${ctx.req.headers.host}`;
  const webhookUrl = `${origin.replace(/\/$/, "")}/api/webhooks/whatsapp`;

  // Verify token is sanitized out of the channels list API (secret-adjacent).
  // The Cloud API channel row carries the token; if none exists yet (first
  // connect) or the stored one is missing or still the old predictable default
  // ("demo-verify-token"), create/persist a freshly generated token NOW — so
  // the token is on screen before the owner clicks Sambungkan, and Meta's
  // webhook Verify can succeed immediately.
  const session = await getSSRSession(ctx);
  let cloudVerifyToken: string | null = null;
  if (session?.user.tenantId) {
    const tenantId = session.user.tenantId;
    const existing = await prisma.channel.findFirst({
      where: { tenantId, provider: "CLOUD_API" },
    });
    const parsed = cloudApiConfigSchema.safeParse(existing?.config);
    const existingToken =
      parsed.success ? parsed.data.verifyToken : undefined;
    const isWeakToken =
      !existingToken || existingToken === "demo-verify-token";
    if (existingToken && !isWeakToken) {
      cloudVerifyToken = existingToken;
    } else if (existing) {
      // Channel exists but has no token (or still the pre-rotation default) —
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
  }

  return { props: { webhookUrl, cloudVerifyToken } };
});
