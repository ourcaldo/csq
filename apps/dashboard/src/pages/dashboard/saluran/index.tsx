import { useEffect, useMemo, useRef, useState } from "react";
import type { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import { useSession } from "next-auth/react";
import {
  Archive,
  ArrowClockwise,
  CaretRight,
  CaretUp,
  CheckCircle,
  CloudArrowUp,
  Copy,
  DeviceMobile,
  DotsThreeVertical,
  MagnifyingGlass,
  PaperPlaneRight,
  PaperPlaneTilt,
  Plugs,
  Plus,
  QrCode,
  Robot,
  ShieldCheck,
  SlidersHorizontal,
  Trash,
  Users,
  Warning,
  WebhooksLogo,
  WhatsappLogo,
  X,
} from "@phosphor-icons/react";
import { QRCodeSVG } from "qrcode.react";
import { withAuth, getSSRSession } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { useEntitlements } from "@/components/dashboard/entitlements-context";
import { apiFetch, apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { LoadingSkeleton } from "@/components/dashboard/loading-skeleton";
import { AgentPicker } from "@/components/dashboard/channels/agent-picker";
import { Field } from "@/components/dashboard/channels/field";
import { Toast } from "@/components/dashboard/channels/toast";
import { ChannelAccessPanel } from "@/components/dashboard/channels/access-panel";
import {
  EMPTY_CLOUD,
  type AgentItem,
  type ChannelView,
  type CloudForm,
  type ConnectResult,
  type Provider,
  type ToastState,
} from "@/components/dashboard/channels/types";
import { cn } from "@csq/ui/lib/utils";

// Channels page - redesign 2026-11-18 (docs/demo/new/gemini-code-...html):
// breadcrumb header with seat counter, collapsible global webhook config,
// 4 filter tabs (Semua/Terhubung/Terputus/Diarsipkan) + search, zinc-styled
// channel cards with overflow menus, 3-step add wizard, and per-action
// confirm modals. Every flow is a modal - nothing renders at page bottom.

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

type FilterTab = "all" | "connected" | "disconnected" | "archived";

export default function SaluranPage({ webhookUrl, verifyToken }: SaluranProps) {
  const router = useRouter();
  const { data: session } = useSession();
  const isOwner = !!session?.user?.isOwner;
  const canConfig =
    isOwner || !!session?.user?.permissions?.includes("saluran.ubah");
  const canAdd =
    isOwner || !!session?.user?.permissions?.includes("saluran.tambah");
  const { data: channelsData, loading, error: fetchError, refresh } =
    useApi<{ items: ChannelView[] }>("/api/dashboard/channels?includeArchived=1");
  // The shared add/reconnect/edit dialog: any of the three grants opens it;
  // the API re-checks the exact permission per flow.
  const canAct =
    canAdd || canConfig || (channelsData?.items ?? []).some((c) => c.canManage);
  const entitlements = useEntitlements();

  const { data: agentsData } = useApi<{ items: AgentItem[] }>(
    "/api/dashboard/agents"
  );

  const channels = channelsData?.items ?? [];
  const activeAgents = (agentsData?.items ?? []).filter(
    (a) => a.status === "ACTIVE"
  );
  const agentName = useMemo(() => {
    const m = new Map(activeAgents.map((a) => [a.id, a.name]));
    return (id: string | null) => (id ? m.get(id) ?? null : null);
  }, [activeAgents]);

  // ── View state ──
  const [webhookOpen, setWebhookOpen] = useState(true);
  const [filter, setFilter] = useState<FilterTab>("all");
  const [search, setSearch] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [testOpen, setTestOpen] = useState<string | null>(null);
  // PRD 29: which channel's access panel is open.
  const [accessFor, setAccessFor] = useState<string | null>(null);

  // ── Modal state ──
  const [modal, setModal] = useState<
    "add" | "edit" | "qr" | "disconnect" | "archive" | "delete" | null
  >(null);
  const [addStep, setAddStep] = useState<1 | 2 | 3>(1);
  const [target, setTarget] = useState<ChannelView | null>(null);

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
  const [rotating, setRotating] = useState(false);
  const [tos, setTos] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [qrAt, setQrAt] = useState<number | null>(null);
  const [qrChannelId, setQrChannelId] = useState<string | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const deadPolls = useRef(0);
  const [busy, setBusy] = useState(false);
  const [testTo, setTestTo] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showToast(msg: string, tone: "success" | "error" = "success") {
    setToast({ msg, tone });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }

  // Close the open dropdown on any outside click / Escape.
  useEffect(() => {
    if (!menuFor) return;
    function close() {
      setMenuFor(null);
    }
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [menuFor]);
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuFor(null);
        setModal(null);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // ── QR poll: runs while ANY Baileys QR is pending (add flow or reconnect).
  useEffect(() => {
    if (!qrChannelId || !qr) return;
    let active = true;
    const tick = async () => {
      try {
        const state = await apiFetch<{ qr: string | null; open: boolean }>(
          `/api/dashboard/channels/${qrChannelId}/qr`
        );
        if (!active) return;
        if (state.open) {
          deadPolls.current = 0;
          setQr(null);
          setQrAt(null);
          setModal(null);
          refresh();
          showToast("Saluran terhubung.");
        } else if (state.qr) {
          deadPolls.current = 0;
          setQr(state.qr);
          setQrAt((prev) => prev ?? Date.now());
        } else if (++deadPolls.current >= 2) {
          deadPolls.current = 0;
          setQr(null);
          setQrAt(null);
          setModalError("Sesi QR berakhir. Klik Generate Kode QR untuk memulai ulang.");
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
  }, [qrChannelId, qr, refresh]);

  const qrStale = qrAt !== null && Date.now() - qrAt > 60_000;

  // ── Flow openers ──
  function openAdd() {
    setModal("add");
    setAddStep(1);
    setTos(false);
    setByoLabel("");
    setCloudForm(EMPTY_CLOUD);
    setQr(null);
    setQrAt(null);
    setModalError(null);
  }

  function pickProvider(p: Provider) {
    setAddStep(p === "CLOUD_API" ? 2 : 3);
    setModalError(null);
  }

  function openEdit(channel: ChannelView) {
    setTarget(channel);
    setModal("edit");
    setModalError(null);
    setCloudForm({
      label: channel.label,
      phoneNumberId: channel.phoneNumberId ?? channel.externalId ?? "",
      token: "",
      appSecret: "",
      businessAccountId: "",
    });
  }

  function openReconnect(channel: ChannelView) {
    setTarget(channel);
    setModal("qr");
    setModalError(null);
    setQr(null);
    setQrAt(null);
  }

  function openConfirm(kind: "disconnect" | "archive" | "delete", channel: ChannelView) {
    setTarget(channel);
    setModal(kind);
    setModalError(null);
  }

  // ── Actions ──
  async function connectCloud() {
    setConnecting(true);
    setModalError(null);
    try {
      // Editing a Baileys channel saves label + agent through the BAILEYS
      // path (connect.ts) - never the Meta config payload. A Baileys edit
      // never re-pairs (that is Tautkan Ulang's job); empty config keeps
      // the stored creds untouched.
      const provider: Provider =
        modal === "edit" && target?.provider === "BAILEYS" ? "BAILEYS" : "CLOUD_API";
      await apiSend<ConnectResult>("/api/dashboard/channels/connect", "POST", {
        provider,
        ...(modal === "edit" && target ? { channelId: target.id } : {}),
        label: cloudForm.label.trim(),
        agentId: agentId || undefined,
        ...(provider === "CLOUD_API"
          ? {
              config: {
                phoneNumberId: cloudForm.phoneNumberId.trim(),
                token: cloudForm.token.trim(),
                appSecret: cloudForm.appSecret.trim(),
                businessAccountId: cloudForm.businessAccountId.trim() || undefined,
              },
            }
          : { config: { tosAcknowledged: true } }),
      });
      setModal(null);
      refresh();
      showToast(modal === "edit" ? "Perubahan konfigurasi disimpan." : "Saluran Meta Cloud API berhasil diverifikasi & terhubung.");
    } catch (e) {
      setModalError(errMsg(e, "Gagal menyambungkan."));
    } finally {
      setConnecting(false);
    }
  }

  async function connectByo() {
    setConnecting(true);
    setModalError(null);
    setQr(null);
    try {
      const res = await apiSend<ConnectResult>(
        "/api/dashboard/channels/connect",
        "POST",
        {
          provider: "BAILEYS",
          ...(modal === "qr" && target ? { channelId: target.id } : {}),
          label: (modal === "qr" ? (target?.label ?? "") : byoLabel).trim(),
          agentId: agentId || undefined,
          config: { tosAcknowledged: true },
        }
      );
      if (res.qr) {
        setQr(res.qr);
        setQrAt(Date.now());
      }
      setQrChannelId(res.channelId);
      refresh();
    } catch (e) {
      setModalError(errMsg(e, "Gagal memulai sambungan."));
    } finally {
      setConnecting(false);
    }
  }

  async function rotateVerifyToken() {
    if (
      !window.confirm(
        "Rotasi Verify Token? Token lama langsung tidak berlaku dan webhook Meta Anda berhenti terverifikasi sampai token baru ditempel di Meta App Dashboard."
      )
    ) {
      return;
    }
    setRotating(true);
    try {
      await apiSend("/api/dashboard/channels/rotate-webhook-token", "POST");
      showToast("Verify Token diputar. Tempel token baru di Meta App Dashboard.");
      router.replace(router.asPath);
    } catch (e) {
      showToast(errMsg(e, "Gagal memutar token."), "error");
    } finally {
      setRotating(false);
    }
  }

  async function confirmAction() {
    if (!target) return;
    setBusy(true);
    setModalError(null);
    const kind = modal;
    try {
      if (kind === "disconnect") {
        await apiSend(`/api/dashboard/channels/disconnect?id=${target.id}`, "POST");
        showToast("Koneksi saluran diputuskan.");
      } else if (kind === "archive") {
        await apiSend(`/api/dashboard/channels/archive?id=${target.id}`, "POST");
        showToast("Saluran dipindahkan ke arsip.");
      } else if (kind === "delete") {
        await apiSend(`/api/dashboard/channels/delete?id=${target.id}`, "POST");
        showToast("Saluran telah dihapus permanen.");
      }
      setModal(null);
      setTarget(null);
      refresh();
    } catch (e) {
      setModalError(errMsg(e, "Aksi gagal."));
    } finally {
      setBusy(false);
    }
  }

  async function sendTest(id: string) {
    const to = (testTo[id] ?? "").trim();
    if (!to) {
      showToast("Masukkan nomor tujuan terlebih dahulu", "error");
      return;
    }
    setTesting(id);
    try {
      await apiSend(`/api/dashboard/channels/test?id=${id}`, "POST", { to });
      showToast(`Pesan uji terkirim ke ${to}`);
      setTestTo((p) => ({ ...p, [id]: "" }));
      setTestOpen(null);
    } catch (e) {
      showToast(errMsg(e, "Pesan uji gagal terkirim."), "error");
    } finally {
      setTesting(null);
    }
  }

  // ── Derived list state ──
  const archived = channels.filter((c) => c.archivedAt);
  const live = channels.filter((c) => !c.archivedAt);
  const connectedCount = live.filter((c) => c.status === "CONNECTED").length;
  const filtered = channels.filter((c) => {
    if (c.archivedAt && filter !== "archived") return false;
    if (filter === "connected") return c.status === "CONNECTED" && !c.archivedAt;
    if (filter === "disconnected") return c.status !== "CONNECTED" && !c.archivedAt;
    if (filter === "archived") return !!c.archivedAt;
    return true;
  }).filter((c) => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    const haystack = `${c.label} ${c.phoneNumber ?? ""} ${c.externalId ?? ""}`.toLowerCase();
    return haystack.includes(q);
  });

  const seatLimit = entitlements?.channelLimit ?? null;
  const seatUsed = entitlements?.usage.channels ?? connectedCount;

  const addTitles: Record<1 | 2 | 3, [string, string]> = {
    1: ["Tambah Saluran Baru", "Pilih metode koneksi nomor WhatsApp Anda"],
    2: ["Konfigurasi WhatsApp Business API", "Kredensial divalidasi langsung ke server Meta Graph API"],
    3: ["Tautkan Nomor via Kode QR", "Gunakan nomor WhatsApp reguler dengan perangkat tertaut"],
  };

  return (
    <DashboardShell
      title="Saluran"
      description="Kelola nomor WhatsApp bisnis maupun perangkat tertaut. Setiap saluran terisolasi dengan riwayat percakapan dan agent AI tersendiri."
      actions={
        <button
          onClick={openAdd}
          disabled={!canAdd}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-zinc-900 px-3.5 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-zinc-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus size={16} />
          <span>Tambah Saluran</span>
        </button>
      }
      headerExtra={
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-zinc-400">
            <CaretRight size={10} className="text-zinc-300" />
            <span>Pengaturan</span>
            <CaretRight size={10} className="text-zinc-300" />
            <span className="font-medium text-zinc-700">Saluran WhatsApp</span>
          </div>
          {seatLimit !== null && (
            <div className="hidden items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs font-medium text-zinc-600 sm:flex">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  seatUsed >= seatLimit ? "bg-amber-500" : "bg-emerald-500"
                )}
              />
              <span className="tabular-nums">
                {seatUsed} / {seatLimit}
              </span>{" "}
              Kursi Aktif
            </div>
          )}
        </div>
      }
    >
      {fetchError && <p className="mb-4 text-sm text-destructive">{fetchError}</p>}

      {!canAdd && !canConfig && !channels.some((c) => c.canManage) && (
        <p className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700">
          Anda tidak memiliki izin mengelola saluran. Anda melihat dalam mode
          baca-saja.
        </p>
      )}

      {loading && <LoadingSkeleton rows={2} />}

      {/* ══ Webhook setup (per tenant Meta app, PRD 15 amendment) ══ */}
      {!loading && (
        <section className="mb-8 overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
          <button
            onClick={() => setWebhookOpen((o) => !o)}
            className="flex w-full items-center justify-between px-5 py-3.5 text-left transition hover:bg-zinc-50/70"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 bg-zinc-50 text-zinc-600">
                <WebhooksLogo size={16} />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-zinc-900">Webhook Meta (Aplikasi Meta Anda)</span>
                <span className="rounded border border-zinc-200 bg-zinc-50 px-1.5 py-0.5 text-[11px] font-medium text-zinc-500">
                  Per akun
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs font-medium text-zinc-500">
              <span>{webhookOpen ? "Sembunyikan" : "Tampilkan"}</span>
              <CaretUp
                size={14}
                className={cn("transition-transform duration-200", !webhookOpen && "rotate-180")}
              />
            </div>
          </button>

          {webhookOpen && (
            <div className="border-t border-zinc-100 bg-zinc-50/40 px-5 py-4">
              <p className="mb-3 text-xs text-zinc-500">
                Buka <strong>Meta App Dashboard milik Anda</strong> (bukan milik platform)
                &rarr; <strong>WhatsApp &rarr; Configuration</strong>, tempel Callback URL dan
                Verify Token di bawah, lalu klik <strong>Verify and Save</strong>. Semua nomor
                di aplikasi Meta yang sama memakai token ini.
              </p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <CopyField label="Callback URL" hint="HTTPS Endpoint" value={webhookUrl} />
                <CopyField
                  label="Verify Token"
                  hint="Token akun Anda - satu untuk semua nomor di aplikasi Meta yang sama"
                  value={verifyToken}
                  onRotate={canConfig ? () => void rotateVerifyToken() : undefined}
                  rotating={rotating}
                />
              </div>
            </div>
          )}
        </section>
      )}

      {/* ══ Filter Tabs & Search ══ */}
      {!loading && channels.length > 0 && (
        <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div className="inline-flex rounded-lg border border-zinc-200 bg-zinc-100/80 p-0.5 text-xs font-medium">
            {(
              [
                ["all", "Semua", channels.length],
                ["connected", "Terhubung", connectedCount],
                ["disconnected", "Terputus", live.length - connectedCount],
                ["archived", "Diarsipkan", archived.length],
              ] as const
            ).map(([key, label, count]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={cn(
                  "rounded-md px-3 py-1.5",
                  filter === key
                    ? "bg-white text-zinc-900 shadow-xs"
                    : "text-zinc-500 hover:text-zinc-900"
                )}
              >
                {label}{" "}
                <span className="ml-1 tabular-nums text-zinc-400">{count}</span>
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-64">
            <MagnifyingGlass
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama atau nomor..."
              className="w-full rounded-lg border border-zinc-200 bg-white py-1.5 pl-8 pr-3 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
            />
          </div>
        </div>
      )}

      {/* ══ Channel List ══ */}
      {!loading && (
        <div className="space-y-3">
          {filtered.map((c) => (
            <ChannelCard
              key={c.id}
              channel={c}
              agentLabel={agentName(c.agentId)}
              canManage={!!c.canManage}
              canConfig={canConfig}
              isOwner={isOwner}
              accessOpen={accessFor === c.id}
              onAccess={() => setAccessFor((m) => (m === c.id ? null : c.id))}
              menuOpen={menuFor === c.id}
              onToggleMenu={() => setMenuFor((m) => (m === c.id ? null : c.id))}
              onTest={() => setTestOpen((t) => (t === c.id ? null : c.id))}
              testOpen={testOpen === c.id}
              testValue={testTo[c.id] ?? ""}
              onTestValue={(v) => setTestTo((p) => ({ ...p, [c.id]: v }))}
              testing={testing === c.id}
              onSendTest={() => void sendTest(c.id)}
              onEdit={() => openEdit(c)}
              onReconnect={() => openReconnect(c)}
              onDisconnect={() => openConfirm("disconnect", c)}
              onArchive={() => openConfirm("archive", c)}
              onDelete={() => openConfirm("delete", c)}
            />
          ))}

          {filtered.length === 0 && channels.length > 0 && (
            <div className="rounded-xl border border-dashed border-zinc-300 bg-white py-12 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-zinc-100 text-zinc-400">
                <WhatsappLogo size={20} />
              </div>
              <p className="mt-3 text-sm font-medium text-zinc-900">Tidak ada saluran ditemukan</p>
              <p className="mt-1 text-xs text-zinc-500">Ubah filter status atau kata kunci pencarian Anda.</p>
            </div>
          )}

          {channels.length === 0 && (
            <div className="rounded-xl border border-dashed border-zinc-300 bg-white py-12 text-center">
              <p className="text-sm font-semibold text-zinc-900">Belum ada agent aktif atau saluran</p>
              <p className="mt-1 text-xs text-zinc-500">
                Deploy sebuah agent di halaman Agent, lalu tambahkan saluran pertama Anda.
              </p>
            </div>
          )}
        </div>
      )}

      {/* ══ Footer Note ══ */}
      {!loading && channels.length > 0 && (
        <div className="mt-6 flex items-center gap-2 text-xs text-zinc-400">
          <ShieldCheck size={14} className="shrink-0" />
          <p>
            Mengarsipkan saluran akan membebaskan kuota kursi aktif Anda tanpa
            menghapus riwayat percakapan. Penghapusan permanen tidak dapat
            dibatalkan.
          </p>
        </div>
      )}

      {/* ═══════════ Modals ═══════════ */}

      {/* Tambah Saluran (3-step wizard) */}
      <Modal open={modal === "add"} onClose={() => setModal(null)} maxWidth="max-w-xl">
        <ModalHeader
          title={addTitles[addStep][0]}
          subtitle={addTitles[addStep][1]}
          onClose={() => setModal(null)}
        />
        <div className="p-6">
          {modalError && (
            <p className="mb-4 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-600">
              {modalError}
            </p>
          )}
          {addStep === 1 && (
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <ProviderCard
                icon={<CloudArrowUp size={18} />}
                iconCls="border-blue-100 bg-blue-50 text-blue-600"
                tag="Direkomendasikan"
                tagCls="bg-emerald-50 text-emerald-700"
                title="WhatsApp Business API"
                desc="Integrasi resmi via Meta Cloud API. Stabil untuk volume pesan tinggi dan bebas risiko pemblokiran."
                cta="Konfigurasi API"
                disabled={!canAct}
                onClick={() => pickProvider("CLOUD_API")}
              />
              <ProviderCard
                icon={<QrCode size={18} />}
                iconCls="border-zinc-200 bg-zinc-50 text-zinc-700"
                tag="Instan"
                tagCls="bg-zinc-100 text-zinc-600"
                title="Tautkan Nomor (QR)"
                desc="Gunakan nomor WhatsApp reguler atau Business yang sudah ada dengan memindai kode QR."
                cta="Pindai QR"
                disabled={!canAct}
                onClick={() => pickProvider("BAILEYS")}
              />
            </div>
          )}

          {addStep === 2 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  label="Nama Label Saluran"
                  value={cloudForm.label}
                  onChange={(v) => setCloud({ label: v })}
                  hint="mis. Sales Utama"
                  disabled={!canAct}
                />
                <AgentPicker
                  agents={activeAgents}
                  value={agentId}
                  onChange={setAgentId}
                  disabled={!canAct}
                />
              </div>
              <Field
                label="Phone Number ID"
                value={cloudForm.phoneNumberId}
                onChange={(v) => setCloud({ phoneNumberId: v })}
                hint="103xxxxxxxxxx"
                disabled={!canAct}
              />
              <Field
                label="Permanent Access Token"
                value={cloudForm.token}
                onChange={(v) => setCloud({ token: v })}
                hint="EAAG..."
                disabled={!canAct}
                type="password"
              />
              <Field
                label="App Secret"
                value={cloudForm.appSecret}
                onChange={(v) => setCloud({ appSecret: v })}
                hint="Wajib - dari aplikasi Meta Anda (App Dashboard > Settings > Basic)"
                disabled={!canAct}
                type="password"
              />
              <div className="flex items-start gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-600">
                <CheckCircle size={14} weight="fill" className="mt-0.5 shrink-0 text-emerald-600" />
                <span>
                  Kredensial divalidasi langsung ke Graph API Meta sebelum saluran
                  diaktifkan. Setelah tersambung, salin Callback URL + Verify Token dari
                  panel <strong>Webhook Meta</strong> ke aplikasi Meta Anda.
                </span>
              </div>
              <div className="flex items-center justify-between border-t border-zinc-100 pt-4">
                <button
                  onClick={() => setAddStep(1)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3.5 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  Kembali
                </button>
                <button
                  onClick={() => void connectCloud()}
                  disabled={connecting || !canAct || !cloudForm.appSecret.trim()}
                  className="rounded-lg bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
                >
                  {connecting ? "Memverifikasi..." : "Verifikasi & Sambungkan"}
                </button>
              </div>
            </div>
          )}

          {addStep === 3 && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field
                  label="Nama Label Saluran"
                  value={byoLabel}
                  onChange={setByoLabel}
                  hint="mis. Support Cabang"
                  disabled={!canAct}
                />
                <AgentPicker
                  agents={activeAgents}
                  value={agentId}
                  onChange={setAgentId}
                  disabled={!canAct}
                />
              </div>
              <div className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50/70 p-3 text-xs text-amber-800">
                <Warning size={16} weight="fill" className="mt-0.5 shrink-0 text-amber-600" />
                <p>
                  Metode perangkat tertaut menggunakan protokol non-resmi.
                  Hindari pengiriman pesan massal (blast) agresif untuk
                  mencegah pembatasan akun oleh WhatsApp.
                </p>
              </div>
              <div className="flex flex-col items-center gap-4 rounded-xl border border-zinc-200 bg-zinc-50/60 p-4 sm:flex-row">
                <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-300 shadow-xs">
                  {qr ? (
                    <QRCodeSVG value={qr} size={110} level="M" />
                  ) : (
                    <QrCode size={56} />
                  )}
                </div>
                <div className="space-y-1.5 text-xs text-zinc-600">
                  <p className="font-semibold text-zinc-900">Langkah Pemindaian:</p>
                  <ol className="list-decimal space-y-1 pl-4 text-zinc-500">
                    <li>Klik tombol <strong>Generate Kode QR</strong> di bawah.</li>
                    <li>Buka WhatsApp di ponsel &rarr; <strong>Perangkat Tertaut</strong>.</li>
                    <li>Arahkan kamera ke layar; status akan aktif otomatis.</li>
                  </ol>
                  {qrStale && (
                    <p className="text-amber-600">Scan belum terdeteksi setelah 1 menit. Coba lagi.</p>
                  )}
                </div>
              </div>
              <label className="flex items-start gap-2 text-xs text-zinc-600">
                <input
                  type="checkbox"
                  checked={tos}
                  disabled={!canAct}
                  onChange={(e) => setTos(e.target.checked)}
                  className="mt-0.5 h-4 w-4 rounded border-zinc-300 accent-zinc-900"
                />
                <span>
                  Saya memahami risiko penggunaan metode perangkat tertaut dan
                  menyetujui ketentuan layanan.
                </span>
              </label>
              <div className="flex items-center justify-between border-t border-zinc-100 pt-4">
                <button
                  onClick={() => setAddStep(1)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3.5 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                >
                  Kembali
                </button>
                <button
                  onClick={() => void connectByo()}
                  disabled={connecting || !canAct || !tos}
                  className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  {connecting ? "Membuat sesi..." : "Generate Kode QR"}
                </button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Konfigurasi / Edit */}
      <Modal open={modal === "edit"} onClose={() => setModal(null)} maxWidth="max-w-lg">
        <ModalHeader
          title="Konfigurasi Saluran"
          subtitle={`${target?.label ?? ""}${target?.phoneNumber ? ` (+${target.phoneNumber})` : ""}`}
          onClose={() => setModal(null)}
        />
        <div className="space-y-4 p-6">
          {modalError && (
            <p className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-600">
              {modalError}
            </p>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Nama Saluran"
              value={cloudForm.label}
              onChange={(v) => setCloud({ label: v })}
              disabled={!canAct}
            />
            <AgentPicker
              agents={activeAgents}
              value={agentId}
              onChange={setAgentId}
              disabled={!canAct}
            />
          </div>
          {target?.provider === "CLOUD_API" && (
            <>
              <Field
                label="Phone Number ID"
                value={cloudForm.phoneNumberId}
                onChange={(v) => setCloud({ phoneNumberId: v })}
                disabled={!canAct}
              />
              <Field
                label="Access Token Baru"
                value={cloudForm.token}
                onChange={(v) => setCloud({ token: v })}
                hint="Kosongkan jika tidak ingin mengubah token"
                disabled={!canAct}
                type="password"
              />
              <Field
                label="App Secret"
                value={cloudForm.appSecret}
                onChange={(v) => setCloud({ appSecret: v })}
                hint="Dari aplikasi Meta Anda (Settings > Basic)"
                disabled={!canAct}
                type="password"
              />
            </>
          )}
          {target?.provider === "BAILEYS" && (
            <p className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs leading-relaxed text-zinc-500">
              Saluran WhatsApp Pribadi (QR) tidak memakai kredensial API.
              Nama dan agent dapat diubah di atas; gunakan Tautkan Ulang
              untuk menyambungkan perangkat baru.
            </p>
          )}
          <div className="flex justify-end gap-2 border-t border-zinc-100 pt-4">
            <button
              onClick={() => setModal(null)}
              className="rounded-lg border border-zinc-200 px-3.5 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Batal
            </button>
            <button
              onClick={() => void connectCloud()}
              disabled={connecting || !canAct}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50"
            >
              {connecting ? "Menyimpan..." : "Simpan Perubahan"}
            </button>
          </div>
        </div>
      </Modal>

      {/* QR Reconnect */}
      <Modal open={modal === "qr"} onClose={() => setModal(null)} maxWidth="max-w-sm">
        <ModalHeader
          title="Tautkan Ulang Perangkat"
          subtitle={`${target?.label ?? ""}${target?.phoneNumber ? ` (+${target.phoneNumber})` : ""}`}
          onClose={() => setModal(null)}
        />
        <div className="flex flex-col items-center p-6 text-center">
          {modalError && (
            <p className="mb-4 w-full rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-700">
              {modalError}
            </p>
          )}
          <div className="flex h-48 w-48 items-center justify-center rounded-2xl border border-zinc-200 bg-zinc-50 text-zinc-300">
            {qr ? (
              <QRCodeSVG value={qr} size={170} level="M" />
            ) : (
              <QrCode size={64} />
            )}
          </div>
          <p className="mt-4 text-xs leading-relaxed text-zinc-500">
            Buka aplikasi WhatsApp di ponsel Anda, masuk ke{" "}
            <strong>Perangkat Tertaut</strong>, lalu pindai kode QR di atas.
          </p>
          <button
            onClick={() => void connectByo()}
            disabled={connecting || !canAct}
            className="mt-5 w-full rounded-lg bg-emerald-600 px-4 py-2 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {connecting ? "Memuat ulang..." : "Tampilkan Kode QR"}
          </button>
        </div>
      </Modal>

      {/* Confirm modals: delete / archive / disconnect */}
      <Modal
        open={modal === "disconnect" || modal === "archive" || modal === "delete"}
        onClose={() => setModal(null)}
        maxWidth="max-w-md"
      >
        <div className="p-6">
          {modalError && (
            <p className="mb-3 rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-600">
              {modalError}
            </p>
          )}
          {modal === "delete" ? (
            <>
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-red-100 bg-red-50 text-red-600">
                <Warning size={20} />
              </div>
              <h3 className="mt-4 text-base font-semibold text-zinc-900">Hapus Saluran Permanen?</h3>
              <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">
                Seluruh riwayat percakapan, log pesan, dan kampanye pada saluran
                ini akan dihapus <strong>secara permanen</strong> dan tidak dapat
                dipulihkan. Gunakan fitur <strong>Arsipkan</strong> jika Anda
                masih membutuhkan datanya.
              </p>
            </>
          ) : (
            <>
              <h3 className="text-base font-semibold text-zinc-900">
                {modal === "disconnect" ? "Putuskan Koneksi Saluran?" : "Arsipkan Saluran?"}
              </h3>
              <p className="mt-1.5 text-xs leading-relaxed text-zinc-500">
                {modal === "disconnect"
                  ? "Saluran akan berhenti mengirim maupun menerima pesan hingga Anda menyambungkannya kembali. Seluruh riwayat chat tetap tersimpan."
                  : "Saluran akan dinonaktifkan dan disembunyikan dari daftar utama, namun seluruh data percakapan tetap aman tersimpan dan kuota kursi paket Anda akan dibebaskan."}
              </p>
            </>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <button
              onClick={() => setModal(null)}
              className="rounded-lg border border-zinc-200 px-3.5 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
            >
              Batal
            </button>
            <button
              onClick={() => void confirmAction()}
              disabled={busy}
              className={cn(
                "rounded-lg px-3.5 py-2 text-xs font-medium text-white disabled:opacity-50",
                modal === "delete"
                  ? "bg-red-600 hover:bg-red-700"
                  : "bg-zinc-900 hover:bg-zinc-800"
              )}
            >
              {busy
                ? "Memproses..."
                : modal === "delete"
                  ? "Ya, Hapus Permanen"
                  : modal === "disconnect"
                    ? "Putuskan"
                    : "Arsipkan Saluran"}
            </button>
          </div>
        </div>
      </Modal>

      <Toast toast={toast} />
    </DashboardShell>
  );
}

// ── Sub-components ──

function CopyField(props: {
  label: string;
  hint: string;
  value: string;
  onRotate?: () => void;
  rotating?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-xs font-medium text-zinc-600">{props.label}</label>
        <span className="text-[11px] text-zinc-400">{props.hint}</span>
      </div>
      <div className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-3 py-2 transition focus-within:border-zinc-400">
        <code className="truncate font-mono text-xs text-zinc-700 select-all">
          {props.value}
        </code>
        <div className="ml-2 flex shrink-0 items-center gap-1">
          {props.onRotate && (
            <button
              onClick={props.onRotate}
              disabled={props.rotating}
              title="Rotasi token"
              aria-label="Rotasi token"
              className="inline-flex items-center rounded p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 disabled:opacity-50"
            >
              <ArrowClockwise size={14} className={props.rotating ? "animate-spin" : undefined} />
            </button>
          )}
          <button
            className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
            onClick={() => {
              void navigator.clipboard.writeText(props.value).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1800);
              });
            }}
          >
            {copied ? (
              <CheckCircle size={14} weight="bold" className="text-emerald-600" />
            ) : (
              <Copy size={14} />
            )}
            <span className={copied ? "text-emerald-600" : ""}>
              {copied ? "Tersalin" : "Salin"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

type ChannelCardProps = {
  channel: ChannelView;
  agentLabel: string | null;
  // PRD 29: KELOLA grant on this channel (QR/test/disconnect) vs the
  // role-level config permission (konfigurasi/archive).
  canManage: boolean;
  canConfig: boolean;
  // Access-grant panel (owner-only, PRD 29 section 6.1).
  isOwner: boolean;
  accessOpen: boolean;
  onAccess: () => void;
  menuOpen: boolean;
  onToggleMenu: () => void;
  testOpen: boolean;
  testValue: string;
  onTestValue: (v: string) => void;
  testing: boolean;
  onSendTest: () => void;
  onTest: () => void;
  onEdit: () => void;
  onReconnect: () => void;
  onDisconnect: () => void;
  onArchive: () => void;
  onDelete: () => void;
};

function ChannelCard(props: ChannelCardProps) {
  const c = props.channel;
  const [idCopied, setIdCopied] = useState(false);
  const connected = c.status === "CONNECTED";
  const archived = !!c.archivedAt;
  return (
    <div
      className={cn(
        "rounded-xl border border-zinc-200 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition",
        archived ? "opacity-70" : "hover:border-zinc-300"
      )}
    >
      <div className="p-5">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
          {/* Left: identity */}
          <div className="flex items-start gap-3.5">
            <div
              className={cn(
                "relative mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50",
                archived ? "text-zinc-400" : connected ? "text-zinc-700" : "text-zinc-500"
              )}
            >
              {c.provider === "CLOUD_API" ? (
                <CloudArrowUp size={20} className="text-blue-600" />
              ) : (
                <DeviceMobile size={20} />
              )}
              {!archived && (
                <span className="absolute -bottom-1 -right-1 flex h-3 w-3 items-center justify-center rounded-full bg-white">
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      connected ? "bg-emerald-500" : "bg-amber-500"
                    )}
                  />
                </span>
              )}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-zinc-900">{c.label}</h3>
                {archived ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500">
                    <Archive size={10} />
                    Diarsipkan
                  </span>
                ) : connected ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Terhubung
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                    Terputus
                  </span>
                )}
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
                    c.provider === "CLOUD_API"
                      ? "border-blue-200/80 bg-blue-50/70 text-blue-700"
                      : "border-zinc-200 bg-zinc-100 text-zinc-600"
                  )}
                >
                  {c.provider === "CLOUD_API" ? (
                    <>
                      <CheckCircle size={10} weight="fill" /> Meta Cloud API
                    </>
                  ) : (
                    "Perangkat Tertaut"
                  )}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500">
                {c.phoneNumber && (
                  <span className="font-mono font-medium tabular-nums text-zinc-700">
                    +{c.phoneNumber.replace(/^\+/, "")}
                  </span>
                )}
                <span className="text-zinc-300">&bull;</span>
                <button
                  type="button"
                  title="Salin Channel ID"
                  onClick={() => {
                    void navigator.clipboard.writeText(c.id).then(() => {
                      setIdCopied(true);
                      setTimeout(() => setIdCopied(false), 1800);
                    });
                  }}
                  className="inline-flex items-center gap-1 font-mono text-[11px] tabular-nums text-zinc-500 transition hover:text-zinc-900"
                >
                  Channel ID: {c.id}
                  {idCopied ? (
                    <CheckCircle size={11} weight="bold" className="text-emerald-600" />
                  ) : (
                    <Copy size={11} />
                  )}
                </button>
                {c.provider === "CLOUD_API" && c.externalId && (
                  <>
                    <span className="text-zinc-300">&bull;</span>
                    <span className="font-mono text-[11px] tabular-nums text-zinc-400">
                      Phone Number ID: {c.externalId}
                    </span>
                  </>
                )}
                {!archived && !connected && c.provider === "BAILEYS" && (
                  <>
                    <span className="text-zinc-300">&bull;</span>
                    <span className="font-medium text-amber-600">
                      Sesi QR berakhir, perlu tautkan ulang
                    </span>
                  </>
                )}
                {props.agentLabel && (
                  <>
                    <span className="text-zinc-300">&bull;</span>
                    <span className="inline-flex items-center gap-1 text-zinc-600">
                      <Robot size={12} className="text-zinc-400" />
                      {props.agentLabel}
                    </span>
                  </>
                )}
                {!c.phoneNumber && !c.externalId && (
                  <span>Belum pernah pairing</span>
                )}
              </div>
            </div>
          </div>

          {/* Right: actions + overflow */}
          {!archived && (
            <div className="flex items-center gap-2 self-end lg:self-center">
              {connected ? (
                <>
                  <button
                    onClick={props.onTest}
                    disabled={!props.canManage}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 hover:text-zinc-900 disabled:opacity-50"
                  >
                    <PaperPlaneTilt size={14} className="text-zinc-500" />
                    <span>Kirim Test</span>
                  </button>
                  <button
                    onClick={props.onEdit}
                    disabled={!props.canConfig}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 hover:text-zinc-900 disabled:opacity-50"
                  >
                    <SlidersHorizontal size={14} className="text-zinc-500" />
                    <span>Konfigurasi</span>
                  </button>
                </>
              ) : (
                <button
                  onClick={props.onReconnect}
                  disabled={!props.canManage}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow-xs transition hover:bg-emerald-700 disabled:opacity-50"
                >
                  <QrCode size={14} />
                  <span>Tautkan Ulang</span>
                </button>
              )}

              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onToggleMenu();
                  }}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-500 transition hover:bg-zinc-50 hover:text-zinc-900"
                  aria-label="Opsi lainnya"
                  disabled={!(props.canManage || props.canConfig)}
                >
                  <DotsThreeVertical size={16} />
                </button>
                {props.menuOpen && (
                  <div className="absolute right-0 z-20 mt-1.5 w-48 origin-top-right rounded-xl border border-zinc-200 bg-white p-1 shadow-lg">
                    {props.isOwner && (
                      <button
                        onClick={props.onAccess}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                      >
                        <Users size={14} className="text-zinc-500" /> Atur Akses
                      </button>
                    )}
                    {connected && (
                      <button
                        onClick={props.onDisconnect}
                        className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                      >
                        <Plugs size={14} className="text-zinc-500" /> Putuskan Koneksi
                      </button>
                    )}
                    <button
                      onClick={props.onArchive}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-zinc-700 hover:bg-zinc-100"
                    >
                      <Archive size={14} className="text-zinc-500" /> Arsipkan Saluran
                    </button>
                    <div className="my-1 border-t border-zinc-100" />
                    <button
                      onClick={props.onDelete}
                      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-red-600 hover:bg-red-50"
                    >
                      <Trash size={14} /> Hapus Permanen
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Archived rows get restore affordance via the same menu-less design: no actions per template */}
        </div>

        {/* Inline test drawer */}
        {props.testOpen && connected && (
          <div className="mt-4 border-t border-zinc-100 pt-4">
            <div className="flex flex-col justify-between gap-3 rounded-lg border border-zinc-200/80 bg-zinc-50/70 p-3 sm:flex-row sm:items-center">
              <div className="flex flex-1 items-center gap-2">
                <span className="shrink-0 text-xs font-medium text-zinc-600">
                  Kirim pesan uji ke:
                </span>
                <input
                  type="tel"
                  value={props.testValue}
                  onChange={(e) => props.onTestValue(e.target.value)}
                  placeholder="6281290088999"
                  className="w-full max-w-xs rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 font-mono text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-zinc-400 focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={props.onTest}
                  className="rounded-md px-2.5 py-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-800"
                >
                  Batal
                </button>
                <button
                  onClick={props.onSendTest}
                  disabled={props.testing}
                  className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white shadow-xs hover:bg-emerald-700 disabled:opacity-50"
                >
                  <PaperPlaneRight size={13} />
                  {props.testing ? "Mengirim..." : "Kirim Sekarang"}
                </button>
              </div>
            </div>
          </div>
        )}
        {/* PRD 29: per-channel access grants (owner-only) */}
        {props.accessOpen && props.isOwner && (
          <ChannelAccessPanel
            channelId={c.id}
            channelLabel={c.label}
            isBaileys={c.provider === "BAILEYS"}
          />
        )}
      </div>
    </div>
  );
}

function ProviderCard(props: {
  icon: React.ReactNode;
  iconCls: string;
  tag: string;
  tagCls: string;
  title: string;
  desc: string;
  cta: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      className="group flex flex-col justify-between rounded-xl border border-zinc-200 bg-white p-4 text-left transition hover:border-zinc-900 hover:shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
    >
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-lg border",
              props.iconCls
            )}
          >
            {props.icon}
          </div>
          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold", props.tagCls)}>
            {props.tag}
          </span>
        </div>
        <p className="text-sm font-semibold text-zinc-900">{props.title}</p>
        <p className="mt-1 text-xs leading-relaxed text-zinc-500">{props.desc}</p>
      </div>
      <div className="mt-4 flex items-center gap-1 text-xs font-medium text-zinc-900 transition-transform group-hover:translate-x-0.5">
        <span>{props.cta}</span>
      </div>
    </button>
  );
}

function Modal(props: {
  open: boolean;
  onClose: () => void;
  maxWidth?: string;
  children: React.ReactNode;
}) {
  if (!props.open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 p-4 backdrop-blur-[2px]"
      style={{ animation: "saluranFadeIn 0.15s ease-out" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <style>{`@keyframes saluranFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes saluranPanelIn { from { transform: scale(0.97) translateY(4px) } to { transform: scale(1) translateY(0) } }`}</style>
      <div
        className={cn(
          "max-h-[calc(100vh-2rem)] w-full overflow-y-auto rounded-2xl border border-zinc-200 bg-white shadow-2xl",
          props.maxWidth ?? "max-w-lg"
        )}
        style={{ animation: "saluranPanelIn 0.15s cubic-bezier(0.16, 1, 0.3, 1)" }}
      >
        {props.children}
      </div>
    </div>
  );
}

function ModalHeader(props: {
  title: string;
  subtitle?: string;
  onClose: () => void;
}) {
  return (
    <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-4">
      <div>
        <h3 className="text-base font-semibold text-zinc-900">{props.title}</h3>
        {props.subtitle && <p className="text-xs text-zinc-500">{props.subtitle}</p>}
      </div>
      <button
        onClick={props.onClose}
        className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
        aria-label="Tutup"
      >
        <X size={16} />
      </button>
    </div>
  );
}

type SaluranProps = {
  webhookUrl: string;
  verifyToken: string;
};

export const getServerSideProps: GetServerSideProps<SaluranProps> = withAuth<
  SaluranProps
>(async (ctx) => {
  const apiBase = (process.env.API_URL ?? "").replace(/\/$/, "");
  const fallback = (
    process.env.NEXTAUTH_URL ?? `https://${ctx.req.headers.host}`
  ).replace(/\/$/, "");
  const webhookUrl = `${apiBase || fallback}/api/webhooks/whatsapp`;

  // PRD 15 amendment (tenant-own-WABA): the verify token lives on the Tenant
  // row (minted at provisioning) - read it straight from the DB, no env token.
  const session = await getSSRSession(ctx);
  const tenant = session?.user.tenantId
    ? await prisma.tenant.findUnique({
        where: { id: session.user.tenantId },
        select: { webhookVerifyToken: true },
      })
    : null;
  if (!tenant) {
    return { props: { webhookUrl, verifyToken: "" } };
  }
  return { props: { webhookUrl, verifyToken: tenant.webhookVerifyToken } };
  // SEC-3 (PRD 16): channel configuration is OWNER-only (PRD 15.9).
}, { requiredPermission: "saluran.lihat" });
