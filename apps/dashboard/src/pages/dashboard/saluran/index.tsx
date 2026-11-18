import { useEffect, useMemo, useRef, useState } from "react";
import type { GetServerSideProps } from "next";
import { useSession } from "next-auth/react";
import {
  Archive,
  CaretRight,
  CaretUp,
  CheckCircle,
  CloudArrowUp,
  Copy,
  DotsThreeVertical,
  Info,
  MagnifyingGlass,
  PaperPlaneRight,
  PaperPlaneTilt,
  PencilSimple,
  Plugs,
  Plus,
  QrCode,
  Robot,
  Trash,
  Warning,
  WhatsappLogo,
  X,
} from "@phosphor-icons/react";
import { QRCodeSVG } from "qrcode.react";
import { withAuth, getSSRSession } from "@csq/core/lib/auth";
import prisma from "@csq/core/lib/db";
import { withTenantContext } from "@csq/core/lib/tenant-context";
import { useEntitlements } from "@/components/dashboard/entitlements-context";
import { apiFetch, apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { LoadingSkeleton } from "@/components/dashboard/loading-skeleton";
import { AgentPicker } from "@/components/dashboard/channels/agent-picker";
import { Field } from "@/components/dashboard/channels/field";
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
import { cn } from "@csq/ui/lib/utils";

// Channels page (PRD 15 multi-channel, layout redesign 2026-11-18 from the
// owner's HTML reference docs/demo/saluran_pengaturan_kanal_whatsapp.html):
// header with seat counter + Tambah button, collapsible app-level webhook
// panel, filter tabs + search, compact channel cards with overflow menus,
// and every form/confirm flow in animated modals - nothing renders at the
// bottom of the page.

function errMsg(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

type FilterTab = "all" | "connected" | "disconnected";

export default function SaluranPage({
  webhookUrl,
  cloudVerifyToken,
}: SaluranProps) {
  const { data: session } = useSession();
  const isOwner = session?.user?.role === "OWNER";
  const entitlements = useEntitlements();

  const { data: channelsData, loading, error: fetchError, refresh } =
    useApi<{ items: ChannelView[] }>("/api/dashboard/channels");
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

  // ── Modal state: one of add | edit | qr | disconnect | archive | delete ──
  const [modal, setModal] = useState<
    "add" | "edit" | "qr" | "disconnect" | "archive" | "delete" | null
  >(null);
  const [addStep, setAddStep] = useState<1 | 2 | 3>(1);
  const [adding, setAdding] = useState<Provider | null>(null);
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
          setModalError("Sesi QR berakhir. Klik Tampilkan QR untuk memulai ulang.");
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
    setAdding(null);
    setTos(false);
    setByoLabel("");
    setCloudForm(EMPTY_CLOUD);
    setQr(null);
    setQrAt(null);
    setModalError(null);
  }

  function pickProvider(p: Provider) {
    setAdding(p);
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
      await apiSend<ConnectResult>("/api/dashboard/channels/connect", "POST", {
        provider: "CLOUD_API",
        ...(modal === "edit" && target ? { channelId: target.id } : {}),
        label: cloudForm.label.trim(),
        agentId: agentId || undefined,
        config: {
          phoneNumberId: cloudForm.phoneNumberId.trim(),
          token: cloudForm.token.trim(),
          appSecret: cloudForm.appSecret.trim() || undefined,
          businessAccountId: cloudForm.businessAccountId.trim() || undefined,
        },
      });
      setModal(null);
      setAdding(null);
      refresh();
      showToast(modal === "edit" ? "Kredensial berhasil diperbarui." : "Saluran WhatsApp Resmi berhasil disambungkan.");
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

  async function confirmAction() {
    if (!target) return;
    setBusy(true);
    setModalError(null);
    const kind = modal;
    try {
      if (kind === "disconnect") {
        await apiSend(`/api/dashboard/channels/disconnect?id=${target.id}`, "POST");
        showToast("Saluran diputuskan.");
      } else if (kind === "archive") {
        await apiSend(`/api/dashboard/channels/archive?id=${target.id}`, "POST");
        showToast("Saluran diarsipkan. Data percakapan tetap tersimpan.");
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
      showToast(`Pesan test dikirim ke ${to}`);
      setTestTo((p) => ({ ...p, [id]: "" }));
      setTestOpen(null);
    } catch (e) {
      showToast(errMsg(e, "Pesan test gagal terkirim."), "error");
    } finally {
      setTesting(null);
    }
  }

  // ── Derived list state ──
  const connectedCount = channels.filter((c) => c.status === "CONNECTED").length;
  const filtered = channels.filter((c) => {
    const matchFilter =
      filter === "all" ||
      (filter === "connected" ? c.status === "CONNECTED" : c.status !== "CONNECTED");
    const q = search.toLowerCase().trim();
    const haystack = `${c.label} ${c.phoneNumber ?? ""} ${c.externalId ?? ""}`.toLowerCase();
    return matchFilter && (!q || haystack.includes(q));
  });

  const seatLimit = entitlements?.channelLimit ?? null;
  const seatUsed = entitlements?.usage.channels ?? connectedCount;

  const addTitles: Record<1 | 2 | 3, [string, string]> = {
    1: ["Tambah Saluran", "Pilih jenis koneksi nomor WhatsApp Anda"],
    2: ["WhatsApp Resmi (Meta Cloud API)", "Masukkan kredensial dari Meta App Dashboard"],
    3: ["Bawa Nomor Sendiri (QR Pairing)", "Pindai kode QR dari aplikasi WhatsApp"],
  };

  return (
    <DashboardShell
      title="Saluran"
      description="Sambungkan satu atau lebih nomor WhatsApp. Setiap saluran punya percakapan dan agent tersendiri."
      actions={
        <button
          onClick={openAdd}
          disabled={!isOwner || activeAgents.length === 0}
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-green-700 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Plus size={14} weight="bold" />
          <span>Tambah Saluran</span>
        </button>
      }
      headerExtra={
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <CaretRight size={10} className="text-slate-300" />
            <span>Pengaturan kanal WhatsApp</span>
          </div>
          {seatLimit !== null && (
            <div className="flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-600">
              <span
                className={cn(
                  "h-1.5 w-1.5 rounded-full",
                  seatUsed >= seatLimit ? "bg-amber-500" : "bg-green-600"
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

      {!isOwner && (
        <p className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700">
          Hanya owner yang dapat mengatur saluran. Anda melihat dalam mode
          baca-saja.
        </p>
      )}

      {loading && <LoadingSkeleton rows={2} />}

      {/* ══ Collapsible global webhook panel ══ */}
      {!loading && (
        <section className="mb-8 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <button
            onClick={() => setWebhookOpen((o) => !o)}
            className="flex w-full items-center justify-between px-5 py-3.5 text-left transition hover:bg-slate-50/80"
          >
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-green-50 text-green-600">
                <Plugs size={18} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-sm font-semibold text-slate-900">
                  Setelan Webhook Meta
                </h2>
                <span className="rounded border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[11px] font-medium text-slate-600">
                  sekali untuk semua nomor
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
              <span className="hidden sm:inline">
                {webhookOpen ? "Sembunyikan" : "Tampilkan"}
              </span>
              <CaretUp
                size={14}
                className={cn(
                  "transition-transform duration-200",
                  !webhookOpen && "rotate-180"
                )}
              />
            </div>
          </button>

          {webhookOpen && (
            <div className="border-t border-slate-100 bg-slate-50/40 px-5 py-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <CopyField label="Callback URL" value={webhookUrl} />
                <CopyField
                  label="Verify Token"
                  value={cloudVerifyToken ?? "-"}
                  onCopied={() => showToast("Disalin ke clipboard")}
                />
              </div>
              <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-500">
                <Info size={14} className="mt-0.5 shrink-0 text-slate-400" />
                <span>
                  Tempel kedua nilai ini di <strong>Meta App Manager (WhatsApp &gt; Configuration)</strong>.
                  Tidak berubah saat menambah atau memutus saluran.
                </span>
              </p>
            </div>
          )}
        </section>
      )}

      {/* ══ Filter tabs & search ══ */}
      {!loading && channels.length > 0 && (
        <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-200/60 p-0.5 text-xs font-medium">
            {(
              [
                ["all", "Semua", channels.length],
                ["connected", "Terhubung", connectedCount],
                ["disconnected", "Terputus", channels.length - connectedCount],
              ] as const
            ).map(([key, label, count]) => (
              <button
                key={key}
                onClick={() => setFilter(key)}
                className={cn(
                  "rounded-md px-3 py-1.5",
                  filter === key
                    ? "bg-white text-slate-900 shadow-sm"
                    : "text-slate-600 hover:text-slate-900"
                )}
              >
                {label}{" "}
                <span className="ml-1 tabular-nums text-slate-400">{count}</span>
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-64">
            <MagnifyingGlass
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari nama atau nomor..."
              className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
            />
          </div>
        </div>
      )}

      {/* ══ Channel list ══ */}
      {!loading && (
        <div className="space-y-3">
          {filtered.map((c) => (
            <ChannelCard
              key={c.id}
              channel={c}
              agentLabel={agentName(c.agentId)}
              isOwner={isOwner}
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
            <div className="rounded-xl border border-dashed border-slate-300 bg-white py-12 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                <WhatsappLogo size={20} />
              </div>
              <p className="mt-3 text-sm font-semibold text-slate-900">
                Tidak ada saluran ditemukan
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Coba ubah filter status atau kata kunci pencarian Anda.
              </p>
            </div>
          )}

          {channels.length === 0 && activeAgents.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white py-12 text-center">
              <p className="text-sm font-semibold text-slate-900">
                Belum ada agent aktif
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Deploy sebuah agent di halaman Agent sebelum menyambungkan
                saluran.
              </p>
            </div>
          )}
        </div>
      )}

      {!loading && channels.length > 0 && (
        <p className="mt-5 flex items-start gap-1.5 text-xs text-slate-400">
          <Info size={14} className="mt-0.5 shrink-0" />
          <span>
            Arsip menyembunyikan saluran tanpa menghapus data. Hapus menghapus
            saluran beserta seluruh percakapannya secara permanen.
          </span>
        </p>
      )}

      {/* ═══════════ Modals ═══════════ */}

      {/* Tambah Saluran (3-step) */}
      <Modal open={modal === "add"} onClose={() => setModal(null)} maxWidth="max-w-2xl">
        <ModalHeader
          title={addTitles[addStep][0]}
          subtitle={addTitles[addStep][1]}
          onClose={() => setModal(null)}
        />
        <div className="p-6">
          {modalError && (
            <p className="mb-4 rounded-lg border border-red-500/40 bg-red-500/10 p-2.5 text-xs text-red-700">
              {modalError}
            </p>
          )}
          {addStep === 1 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <ProviderCard
                icon={<CloudArrowUp size={20} />}
                iconCls="bg-blue-50 text-blue-600"
                tag="Resmi"
                tagCls="bg-blue-50 text-blue-700"
                title="WhatsApp Resmi"
                desc="Via Meta Cloud API. Resmi, patuh ToS, cocok untuk nomor bisnis."
                disabled={!isOwner || activeAgents.length === 0}
                onClick={() => pickProvider("CLOUD_API")}
              />
              <ProviderCard
                icon={<WhatsappLogo size={20} />}
                iconCls="bg-green-50 text-green-600"
                tag="QR Pairing"
                tagCls="bg-slate-100 text-slate-600"
                title="Bawa Nomor Sendiri"
                desc="Pindai QR dari aplikasi WhatsApp. Aktif dalam hitungan menit."
                disabled={!isOwner || activeAgents.length === 0}
                onClick={() => pickProvider("BAILEYS")}
              />
            </div>
          )}

          {addStep === 2 && (
            <div className="space-y-3.5">
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <Field
                  label="Nama saluran"
                  value={cloudForm.label}
                  onChange={(v) => setCloud({ label: v })}
                  hint="mis. Sales Utama"
                  disabled={!isOwner}
                />
                <AgentPicker
                  agents={activeAgents}
                  value={agentId}
                  onChange={setAgentId}
                  disabled={!isOwner}
                />
              </div>
              <Field
                label="Phone Number ID"
                value={cloudForm.phoneNumberId}
                onChange={(v) => setCloud({ phoneNumberId: v })}
                hint="Contoh: 103xxxxxxxxxx"
                disabled={!isOwner}
              />
              <Field
                label="Access Token"
                value={cloudForm.token}
                onChange={(v) => setCloud({ token: v })}
                hint="Token akses Meta Graph API, diawali EAAG..."
                disabled={!isOwner}
                type="password"
              />
              <Field
                label="App Secret (opsional)"
                value={cloudForm.appSecret}
                onChange={(v) => setCloud({ appSecret: v })}
                disabled={!isOwner}
                type="password"
              />
              <p className="flex items-start gap-2 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-600">
                <CheckCircle size={14} weight="fill" className="mt-0.5 shrink-0 text-green-600" />
                <span>
                  Nomor diverifikasi ke Meta saat menyambungkan - ID yang salah
                  langsung ditolak.
                </span>
              </p>
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button
                  onClick={() => setAddStep(1)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Kembali
                </button>
                <button
                  onClick={() => void connectCloud()}
                  disabled={connecting || !isOwner}
                  className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {connecting ? "Menyambungkan..." : "Sambungkan"}
                </button>
              </div>
            </div>
          )}

          {addStep === 3 && (
            <div className="space-y-3.5">
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <Field
                  label="Nama saluran"
                  value={byoLabel}
                  onChange={setByoLabel}
                  hint="mis. Support Pribadi"
                  disabled={!isOwner}
                />
                <AgentPicker
                  agents={activeAgents}
                  value={agentId}
                  onChange={setAgentId}
                  disabled={!isOwner}
                />
              </div>
              <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-700">
                <Warning size={14} weight="fill" className="mt-0.5 shrink-0" />
                <span>
                  Metode tidak resmi - nomor berisiko diblokir WhatsApp. Gunakan
                  nomor bisnis khusus, bukan nomor pribadi utama Anda.
                </span>
              </p>
              <div className="flex flex-col items-center gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:flex-row">
                <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-300 shadow-inner">
                  {qr ? (
                    <QRCodeSVG value={qr} size={96} level="M" />
                  ) : (
                    <QrCode size={44} />
                  )}
                </div>
                <p className="text-xs leading-relaxed text-slate-600">
                  Klik <strong>&quot;Tampilkan QR&quot;</strong>, lalu pindai dari{" "}
                  <strong>WhatsApp &gt; Tautkan perangkat</strong>. QR tampil di
                  sini dan diperbarui otomatis.
                  {qrStale && (
                    <span className="mt-1 block text-amber-700">
                      Scan belum terdeteksi setelah 1 menit. Coba lagi.
                    </span>
                  )}
                </p>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={tos}
                  disabled={!isOwner}
                  onChange={(e) => setTos(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 accent-green-600"
                />
                <span>Saya menyetujui ketentuan layanan untuk nomor pribadi.</span>
              </label>
              <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
                <button
                  onClick={() => setAddStep(1)}
                  className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Kembali
                </button>
                <button
                  onClick={() => void connectByo()}
                  disabled={connecting || !isOwner || !tos}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
                >
                  <QrCode size={14} />
                  {connecting ? "Memuat..." : "Tampilkan QR"}
                </button>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* Edit Kredensial */}
      <Modal open={modal === "edit"} onClose={() => setModal(null)} maxWidth="max-w-lg">
        <ModalHeader
          title={`Edit Kredensial - ${target?.label ?? ""}`}
          subtitle="Nomor diverifikasi ulang ke Meta saat disimpan."
          onClose={() => setModal(null)}
        />
        <div className="space-y-3.5 p-6">
          {modalError && (
            <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-2.5 text-xs text-red-700">
              {modalError}
            </p>
          )}
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field
              label="Nama saluran"
              value={cloudForm.label}
              onChange={(v) => setCloud({ label: v })}
              disabled={!isOwner}
            />
            <AgentPicker
              agents={activeAgents}
              value={agentId}
              onChange={setAgentId}
              disabled={!isOwner}
            />
          </div>
          <Field
            label="Phone Number ID"
            value={cloudForm.phoneNumberId}
            onChange={(v) => setCloud({ phoneNumberId: v })}
            disabled={!isOwner}
          />
          <Field
            label="Access Token"
            value={cloudForm.token}
            onChange={(v) => setCloud({ token: v })}
            hint="Masukkan ulang token akses Meta Graph API"
            disabled={!isOwner}
            type="password"
          />
          <Field
            label="App Secret (opsional)"
            value={cloudForm.appSecret}
            onChange={(v) => setCloud({ appSecret: v })}
            disabled={!isOwner}
            type="password"
          />
          <div className="flex justify-end gap-2 border-t border-slate-100 pt-4">
            <button
              onClick={() => setModal(null)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Batal
            </button>
            <button
              onClick={() => void connectCloud()}
              disabled={connecting || !isOwner}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
            >
              {connecting ? "Menyimpan..." : "Simpan"}
            </button>
          </div>
        </div>
      </Modal>

      {/* QR pairing (reconnect Baileys) */}
      <Modal open={modal === "qr"} onClose={() => setModal(null)} maxWidth="max-w-md">
        <ModalHeader
          title={`Sambungkan - ${target?.label ?? ""}`}
          subtitle="Pindai QR dari aplikasi WhatsApp"
          onClose={() => setModal(null)}
        />
        <div className="flex flex-col items-center gap-4 p-6 text-center">
          {modalError && (
            <p className="w-full rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-700">
              {modalError}
            </p>
          )}
          <div className="flex h-44 w-44 items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-slate-300">
            {qr ? (
              <QRCodeSVG value={qr} size={160} level="M" />
            ) : (
              <QrCode size={72} />
            )}
          </div>
          <p className="text-xs leading-relaxed text-slate-500">
            Buka <strong>WhatsApp &gt; Tautkan perangkat</strong>, lalu pindai QR
            ini. Status diperbarui otomatis.
            {qrStale && (
              <span className="mt-1 block text-amber-700">
                Scan belum terdeteksi setelah 1 menit. Coba lagi.
              </span>
            )}
          </p>
          <button
            onClick={() => void connectByo()}
            disabled={connecting || !isOwner}
            className="w-full rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50"
          >
            {connecting ? "Memuat..." : "Tampilkan QR"}
          </button>
        </div>
      </Modal>

      {/* Confirm dialogs: disconnect / archive / delete */}
      <Modal
        open={modal === "disconnect" || modal === "archive" || modal === "delete"}
        onClose={() => setModal(null)}
        maxWidth="max-w-md"
      >
        <div className="p-6">
          {modalError && (
            <p className="mb-3 rounded-lg border border-red-500/40 bg-red-500/10 p-2.5 text-xs text-red-700">
              {modalError}
            </p>
          )}
          {modal === "delete" ? (
            <>
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-red-600">
                <Warning size={22} />
              </div>
              <h3 className="text-base font-semibold text-slate-900">
                Hapus saluran &quot;{target?.label ?? ""}&quot;?
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                Semua percakapan, pesan, dan riwayat pengiriman di saluran ini
                ikut terhapus <strong>permanen</strong> dan tidak bisa
                dikembalikan. Jika hanya ingin menyembunyikannya tanpa
                menghapus data, gunakan <strong>Arsipkan</strong>.
              </p>
            </>
          ) : (
            <>
              <h3 className="text-base font-semibold text-slate-900">
                {modal === "disconnect" ? "Putuskan" : "Arsipkan"} &quot;{target?.label ?? ""}&quot;?
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-500">
                {modal === "disconnect"
                  ? "Saluran berhenti mengirim dan menerima pesan sampai disambungkan kembali. Percakapan tersimpan."
                  : "Saluran disembunyikan dari daftar, data percakapan tetap tersimpan, dan kursi paket terbebaskan."}
              </p>
            </>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <button
              onClick={() => setModal(null)}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Batal
            </button>
            <button
              onClick={() => void confirmAction()}
              disabled={busy}
              className={cn(
                "rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50",
                modal === "delete"
                  ? "bg-red-600 hover:bg-red-700"
                  : "bg-slate-800 hover:bg-slate-900"
              )}
            >
              {busy
                ? "Memproses..."
                : modal === "delete"
                  ? "Ya, Hapus Permanen"
                  : modal === "disconnect"
                    ? "Putuskan"
                    : "Arsipkan"}
            </button>
          </div>
        </div>
      </Modal>

      <Toast toast={toast} />
    </DashboardShell>
  );
}

// ── Sub-components (local to the page redesign) ──

function CopyField(props: { label: string; value: string; onCopied?: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-xs font-medium text-slate-600">{props.label}</label>
      </div>
      <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 transition focus-within:border-slate-400">
        <code className="truncate font-mono text-xs text-slate-700 select-all">
          {props.value}
        </code>
        <button
          className="ml-2 inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
          onClick={() => {
            void navigator.clipboard.writeText(props.value).then(() => {
              setCopied(true);
              props.onCopied?.();
              setTimeout(() => setCopied(false), 1800);
            });
          }}
        >
          {copied ? (
            <CheckCircle size={14} weight="bold" className="text-green-600" />
          ) : (
            <Copy size={14} />
          )}
          <span className={copied ? "text-green-600" : ""}>
            {copied ? "Tersalin" : "Salin"}
          </span>
        </button>
      </div>
    </div>
  );
}

type ChannelCardProps = {
  channel: ChannelView;
  agentLabel: string | null;
  isOwner: boolean;
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
  const connected = c.status === "CONNECTED";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-slate-300">
      <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
        {/* Left: identity & metadata */}
        <div className="flex items-start gap-3.5">
          <div
            className={cn(
              "relative mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
              c.provider === "CLOUD_API"
                ? "bg-blue-50 text-blue-600"
                : "bg-green-50 text-green-600"
            )}
          >
            {c.provider === "CLOUD_API" ? (
              <CloudArrowUp size={20} />
            ) : (
              <WhatsappLogo size={20} />
            )}
            <span className="absolute -bottom-0.5 -right-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-white">
              <span
                className={cn(
                  "h-2 w-2 rounded-full",
                  connected ? "bg-green-600" : "bg-slate-400"
                )}
              />
            </span>
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-semibold text-slate-900">{c.label}</span>
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                  connected
                    ? "bg-green-100 text-green-700"
                    : "bg-slate-100 text-slate-600"
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    connected ? "bg-green-600" : "bg-slate-400"
                  )}
                />
                {connected ? "Terhubung" : "Terputus"}
              </span>
              <span
                className={cn(
                  "rounded px-1.5 py-0.5 text-[11px] font-medium",
                  c.provider === "CLOUD_API"
                    ? "bg-blue-50 text-blue-700"
                    : "bg-slate-100 text-slate-600"
                )}
              >
                {c.provider === "CLOUD_API" ? "Resmi" : "Pribadi"}
              </span>
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500">
              {c.phoneNumber && (
                <span className="font-mono font-medium tabular-nums text-slate-700">
                  +{c.phoneNumber.replace(/^\+/, "")}
                </span>
              )}
              {c.externalId && (
                <>
                  <span className="text-slate-300">&bull;</span>
                  <span className="font-mono text-[11px] tabular-nums text-slate-400">
                    ID {c.externalId}
                  </span>
                </>
              )}
              {props.agentLabel && (
                <>
                  <span className="text-slate-300">&bull;</span>
                  <span className="inline-flex items-center gap-1 text-slate-600">
                    <Robot size={12} className="text-slate-400" />
                    {props.agentLabel}
                  </span>
                </>
              )}
              {!c.phoneNumber && !c.externalId && (
                <span>{c.provider === "BAILEYS" ? "Belum pernah pairing" : "Belum terkonfigurasi"}</span>
              )}
            </div>
          </div>
        </div>

        {/* Right: primary actions + overflow menu */}
        <div className="flex items-center gap-2 self-end md:self-center">
          {connected ? (
            <>
              <button
                onClick={props.onTest}
                disabled={!props.isOwner}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
              >
                <PaperPlaneTilt size={13} className="text-slate-500" />
                <span>Kirim Test</span>
              </button>
              {c.provider === "CLOUD_API" ? (
                <button
                  onClick={props.onEdit}
                  disabled={!props.isOwner}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  <PencilSimple size={13} className="text-slate-500" />
                  <span>Edit Kredensial</span>
                </button>
              ) : null}
            </>
          ) : (
            <button
              onClick={props.onReconnect}
              disabled={!props.isOwner}
              className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-green-700 disabled:opacity-50"
            >
              <QrCode size={13} />
              <span>{c.provider === "BAILEYS" ? "Sambungkan" : "Sambungkan"}</span>
            </button>
          )}

          {/* Overflow dropdown */}
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                props.onToggleMenu();
              }}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-900"
              aria-label="Opsi saluran"
              disabled={!props.isOwner}
            >
              <DotsThreeVertical size={16} />
            </button>
            {props.menuOpen && (
              <div className="absolute right-0 z-20 mt-1.5 w-44 origin-top-right rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
                {connected && (
                  <button
                    onClick={props.onDisconnect}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Plugs size={14} className="text-slate-500" /> Putuskan
                  </button>
                )}
                <button
                  onClick={props.onArchive}
                  className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Archive size={14} className="text-slate-500" /> Arsipkan
                </button>
                <div className="my-1 border-t border-slate-100" />
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
      </div>

      {/* Inline test row */}
      {props.testOpen && connected && (
        <div className="mt-4 border-t border-slate-100 pt-3.5">
          <div className="flex flex-col justify-between gap-2.5 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:flex-row sm:items-center">
            <div className="flex flex-1 items-center gap-2.5">
              <span className="shrink-0 text-xs font-medium text-slate-600">
                Nomor tujuan:
              </span>
              <input
                type="tel"
                value={props.testValue}
                onChange={(e) => props.onTestValue(e.target.value)}
                placeholder="mis. 6281290088999"
                className="w-full max-w-xs rounded-lg border border-slate-200 bg-white px-3 py-1.5 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:outline-none"
              />
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={props.onTest}
                className="rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-800"
              >
                Batal
              </button>
              <button
                onClick={props.onSendTest}
                disabled={props.testing}
                className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
              >
                <PaperPlaneRight size={13} />
                {props.testing ? "Mengirim..." : "Kirim"}
              </button>
            </div>
          </div>
        </div>
      )}
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
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      className="group flex flex-col justify-between rounded-xl border-2 border-slate-200 p-5 text-left transition hover:border-green-500 hover:bg-slate-50/40 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <div>
        <div className="mb-3 flex items-center justify-between">
          <div
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-lg",
              props.iconCls
            )}
          >
            {props.icon}
          </div>
          <span
            className={cn(
              "rounded px-2 py-0.5 text-[10px] font-semibold",
              props.tagCls
            )}
          >
            {props.tag}
          </span>
        </div>
        <p className="font-semibold text-slate-900">{props.title}</p>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">{props.desc}</p>
      </div>
      <div className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-green-600">
        <span>Lanjutkan</span>
      </div>
    </button>
  );
}

// Animated modal shell matching the reference: backdrop blur + fade, panel
// scale-in. Escape and backdrop click close (handled by the page-level
// listener + onClose).
function Modal(props: {
  open: boolean;
  onClose: () => void;
  maxWidth?: string;
  children: React.ReactNode;
}) {
  if (!props.open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4 opacity-100 backdrop-blur-[2px]"
      style={{ animation: "fadeIn 0.16s ease-out" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <style>{`@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes panelIn { from { transform: scale(0.97) translateY(6px) } to { transform: scale(1) translateY(0) } }`}</style>
      <div
        className={cn(
          "modal-panel w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl",
          props.maxWidth ?? "max-w-lg"
        )}
        style={{ animation: "panelIn 0.18s cubic-bezier(0.16, 1, 0.3, 1)" }}
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
    <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
      <div>
        <h3 className="text-base font-semibold text-slate-900">{props.title}</h3>
        {props.subtitle && (
          <p className="text-xs text-slate-500">{props.subtitle}</p>
        )}
      </div>
      <button
        onClick={props.onClose}
        className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        aria-label="Tutup"
      >
        <X size={16} />
      </button>
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
  // Webhook URL shown in the UI: the webhook lives in apps/api (Phase 7), so
  // its URL comes from API_URL; the request-origin fallback only serves dev.
  const apiBase = (process.env.API_URL ?? "").replace(/\/$/, "");
  const fallback = (
    process.env.NEXTAUTH_URL ?? `https://${ctx.req.headers.host}`
  ).replace(/\/$/, "");
  const webhookUrl = `${apiBase || fallback}/api/webhooks/whatsapp`;

  // PRD 15: the verify token is app-level (WHATSAPP_VERIFY_TOKEN on the api
  // service). The legacy per-channel token is the transition fallback shown
  // when env is unset.
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
