import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { GetServerSideProps } from "next";
import { useSession } from "next-auth/react";
import {
  CheckCircle,
  Copy,
  LockSimple,
  MagnifyingGlass,
  Notepad,
  PencilSimple,
  Plus,
  Sparkle,
  Trash,
  Warning,
  WhatsappLogo,
  X,
} from "@phosphor-icons/react";
import { withAuth } from "@csq/core/lib/auth";
import { apiSend, ApiError } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import type { MessageTemplate } from "@csq/core/lib/message-templates";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { LoadingSkeleton } from "@/components/dashboard/loading-skeleton";
import { cn } from "@csq/ui/lib/utils";

// Template Pesan - redesign 2026-11-18 (docs/demo/new/
// template_pesan_csq_message_templates.html): metric cards, kind filter tabs
// (Semua/CSQ/Meta) + search, card grid with system-key badges and live
// previews, slide-over form drawer with jenis selector + key picker + char
// counter + WhatsApp bubble preview, delete confirm drawer, staff read-only
// notice. Wired to the existing /api/dashboard/templates routes.

type SystemKey = { key: string; label: string; description: string };
type ListResult = { items: MessageTemplate[]; systemKeys: SystemKey[] };

function errMsg(e: unknown, fallback: string): string {
  return e instanceof ApiError || e instanceof Error ? e.message : fallback;
}

export default function TemplatesPage() {
  const { data: session } = useSession();
  const canManage = !!session?.user?.isOwner || !!session?.user?.permissions?.includes("template.kelola");

  const { data, loading, error, refresh } = useApi<ListResult>("/api/dashboard/templates");
  const templates = useMemo(() => data?.items ?? [], [data]);
  const systemKeys = data?.systemKeys ?? [];

  // ── View state ──
  const [kindFilter, setKindFilter] = useState<"ALL" | "CSQ" | "META">("ALL");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter((t) => {
      const okKind = kindFilter === "ALL" || t.kind === kindFilter;
      const okQ =
        !q ||
        t.label.toLowerCase().includes(q) ||
        t.key.toLowerCase().includes(q) ||
        (t.body ?? "").toLowerCase().includes(q) ||
        (t.metaName ?? "").toLowerCase().includes(q);
      return okKind && okQ;
    });
  }, [templates, kindFilter, search]);

  const stats = {
    total: templates.length,
    csq: templates.filter((t) => t.kind === "CSQ").length,
    meta: templates.filter((t) => t.kind === "META").length,
  };

  // ── Drawer state ──
  const [drawer, setDrawer] = useState<"form" | "del" | null>(null);
  const [editing, setEditing] = useState<MessageTemplate | null>(null);
  const [drawerError, setDrawerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2800);
  }

  // Form state
  const [formKind, setFormKind] = useState<"CSQ" | "META">("CSQ");
  const [keyOption, setKeyOption] = useState("custom");
  const [customKey, setCustomKey] = useState("");
  const [label, setLabel] = useState("");
  const [body, setBody] = useState("");
  const [metaName, setMetaName] = useState("");
  const [metaLang, setMetaLang] = useState("id");

  const selectedSys = systemKeys.find((k) => `sys:${k.key}` === keyOption);
  const usedKeys = templates
    .filter((t) => t.kind === formKind && t.id !== editing?.id)
    .map((t) => t.key);

  function openForm(t: MessageTemplate | null) {
    setEditing(t);
    setDrawerError(null);
    if (t) {
      setFormKind(t.kind);
      setLabel(t.label);
      setBody(t.body ?? "");
      setMetaName(t.metaName ?? "");
      setMetaLang(t.metaLanguage ?? "id");
      const sys = systemKeys.some((k) => k.key === t.key);
      setKeyOption(sys ? `sys:${t.key}` : "custom");
      setCustomKey(t.key);
    } else {
      setFormKind("CSQ");
      setKeyOption("custom");
      setCustomKey("");
      setLabel("");
      setBody("");
      setMetaName("");
      setMetaLang("id");
    }
    setDrawer("form");
  }

  // ── Delete state ──
  const [delTarget, setDelTarget] = useState<MessageTemplate | null>(null);

  function askDelete(t: MessageTemplate) {
    setDelTarget(t);
    setDrawer("del");
  }

  async function confirmDelete() {
    if (!delTarget) return;
    setBusy(true);
    setDrawerError(null);
    try {
      await apiSend(`/api/dashboard/templates?id=${delTarget.id}`, "DELETE");
      setDrawer(null);
      setDelTarget(null);
      refresh();
      showToast(`Template "${delTarget.label}" dihapus`);
    } catch (e) {
      setDrawerError(errMsg(e, "Gagal menghapus template."));
    } finally {
      setBusy(false);
    }
  }

  function resolveKey(): string {
    if (keyOption === "custom") return customKey.trim();
    return keyOption.startsWith("sys:") ? keyOption.slice(4) : keyOption;
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setDrawerError(null);
    const key = resolveKey();
    if (!key) {
      setDrawerError("Key template wajib diisi.");
      return;
    }
    if (keyOption === "custom" && !/^[a-z0-9_]+$/.test(key)) {
      setDrawerError("Nama fungsi hanya boleh menggunakan huruf kecil, angka, dan underscore (_).");
      return;
    }
    const dup = templates.find(
      (t) => t.key === key && t.kind === formKind && t.id !== editing?.id
    );
    if (dup) {
      setDrawerError("Template dengan fungsi dan jenis yang sama sudah ada.");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        key,
        label: label.trim(),
        kind: formKind,
        body: formKind === "CSQ" ? body.trim() : "",
        ...(formKind === "META" ? { metaName: metaName.trim(), metaLanguage: metaLang.trim() || "id" } : {}),
      };
      if (editing) {
        // Replace-list semantics on the API: PUT takes the whole array.
        const next = templates
          .filter((t) => !(t.key === payload.key && t.kind === payload.kind))
          .map((t) => (t.id === editing.id ? { ...t, ...payload } : t));
        await apiSend("/api/dashboard/templates", "PUT", next);
        showToast("Perubahan template disimpan");
      } else {
        await apiSend("/api/dashboard/templates", "POST", payload);
        showToast("Template baru ditambahkan");
      }
      setDrawer(null);
      refresh();
    } catch (e) {
      setDrawerError(errMsg(e, "Gagal menyimpan template."));
    } finally {
      setBusy(false);
    }
  }

  function copyContent(t: MessageTemplate) {
    const text = t.kind === "META" ? t.metaName ?? "" : t.body ?? "";
    void navigator.clipboard.writeText(text);
    showToast((t.kind === "META" ? "Nama template Meta" : "Isi template") + " disalin");
  }

  return (
    <DashboardShell
      title="Template Pesan"
      description="Kelola template pesan CSQ (teks bebas dalam window 24 jam) dan template Meta (wajib di-approve di Meta untuk pesan proaktif di luar window)."
      actions={
        canManage ? (
          <button
            onClick={() => openForm(null)}
            className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg bg-green-600 px-3.5 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-green-700 active:scale-[0.99]"
          >
            <Plus size={14} weight="bold" />
            <span>Tambah Template</span>
          </button>
        ) : undefined
      }
    >
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}
      {loading && <LoadingSkeleton rows={3} />}

      {/* Staff read-only notice */}
      {!loading && !canManage && (
        <div className="mb-5 flex items-start gap-2.5 rounded-xl border border-slate-200 bg-white p-3.5 text-xs text-slate-600 shadow-xs">
          <LockSimple size={16} weight="fill" className="mt-0.5 shrink-0 text-slate-400" />
          <div>
            <p className="font-semibold text-slate-800">Mode Baca Saja (Staf)</p>
            <p className="mt-0.5 text-slate-500">
              Hanya akun dengan peran <strong>Owner</strong> yang dapat membuat,
              mengubah, atau menghapus template pesan.
            </p>
          </div>
        </div>
      )}

      {!loading && (
        <>
          {/* Summary strip */}
          <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <StatCard
              label="Total Template"
              value={stats.total}
              icon={<Notepad size={16} className="text-slate-400" />}
            />
            <StatCard
              label="Template CSQ (24 Jam)"
              value={stats.csq}
              badge={<span className="rounded bg-green-50 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">CSQ</span>}
            />
            <StatCard
              label="Template Meta (Approved)"
              value={stats.meta}
              badge={<span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">Meta</span>}
            />
          </div>

          {/* Filter tabs & search */}
          <div className="mb-5 flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3.5 shadow-xs sm:flex-row sm:items-center">
            <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100/80 p-0.5 text-xs font-medium">
              {(
                [
                  ["ALL", "Semua"],
                  ["CSQ", "CSQ (Teks Bebas)"],
                  ["META", "Meta (Approved)"],
                ] as const
              ).map(([k, l]) => (
                <button
                  key={k}
                  onClick={() => setKindFilter(k)}
                  className={cn(
                    "rounded-md px-3 py-1.5",
                    kindFilter === k
                      ? "bg-white text-slate-900 shadow-xs"
                      : "text-slate-600 hover:text-slate-900"
                  )}
                >
                  {l}
                </button>
              ))}
            </div>
            <div className="relative w-full sm:w-64">
              <MagnifyingGlass
                size={14}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari nama, key, atau isi..."
                className="w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 pl-8 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-slate-400 focus:bg-white focus:outline-none"
              />
            </div>
          </div>

          {/* Empty state */}
          {filtered.length === 0 && (
            <div className="rounded-xl border border-dashed border-slate-300 bg-white py-14 text-center">
              <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                <Notepad size={20} />
              </div>
              <p className="mt-3 text-sm font-semibold text-slate-900">Tidak ada template ditemukan</p>
              <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
                Tambahkan template CSQ untuk pesan otomatis, atau daftarkan nama
                template Meta yang sudah di-approve.
              </p>
            </div>
          )}

          {/* Card grid */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((t) => {
              const sys = systemKeys.find((k) => k.key === t.key);
              const isMeta = t.kind === "META";
              return (
                <div
                  key={t.id}
                  className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-xs transition hover:border-slate-300"
                >
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{t.label}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-600">
                          {t.key}
                        </code>
                        {sys && (
                          <span className="inline-flex items-center gap-0.5 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                            <Sparkle size={10} weight="fill" /> Sistem
                          </span>
                        )}
                      </div>
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
                        isMeta
                          ? "border-blue-200/70 bg-blue-50 text-blue-700"
                          : "border-green-200/70 bg-green-50 text-green-700"
                      )}
                    >
                      {isMeta ? "Meta" : "CSQ"}
                    </span>
                  </div>
                  {sys && (
                    <p className="mb-3 text-xs leading-relaxed text-slate-500">{sys.description}</p>
                  )}
                  {isMeta ? (
                    <div className="mb-4 flex flex-col justify-center rounded-lg border border-blue-100 bg-blue-50/50 p-3 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-medium text-blue-700">Meta Template Name</span>
                        <span className="rounded bg-white px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase text-blue-700 shadow-2xs">
                          {t.metaLanguage ?? "id"}
                        </span>
                      </div>
                      <code className="mt-1 font-mono text-xs font-semibold text-slate-900">
                        {t.metaName ?? "-"}
                      </code>
                    </div>
                  ) : (
                    <div className="mb-4 flex-1 rounded-lg border border-slate-100 bg-slate-50/80 p-3">
                      <p className="line-clamp-3 whitespace-pre-line text-xs leading-relaxed text-slate-600">
                        {t.body}
                      </p>
                    </div>
                  )}
                  <div className="mt-auto flex items-center justify-between border-t border-slate-100 pt-3">
                    <button
                      onClick={() => copyContent(t)}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
                    >
                      <Copy size={14} /> {canManage ? "Salin" : "Salin Isi"}
                    </button>
                    {canManage ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => openForm(t)}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                        >
                          <PencilSimple size={12} className="text-slate-500" /> Edit
                        </button>
                        <button
                          onClick={() => askDelete(t)}
                          title="Hapus template"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash size={14} />
                        </button>
                      </div>
                    ) : (
                      <span className="text-[11px] text-slate-400">Hanya baca</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ═══════════ Form Drawer ═══════════ */}
      <Drawer
        open={drawer === "form"}
        onClose={() => setDrawer(null)}
        title={editing ? "Edit Template" : "Tambah Template Baru"}
        subtitle={editing ? editing.label : "Konfigurasi template pesan CSQ atau Meta Cloud API"}
      >
        <form className="flex flex-1 flex-col overflow-hidden" onSubmit={onSave}>
          <div className="flex-1 space-y-4 overflow-y-auto p-6">
            {drawerError && <FormError msg={drawerError} />}

            {/* Jenis selector */}
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-700">Jenis Template</label>
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => setFormKind("CSQ")}
                  className={cn(
                    "flex flex-col items-start rounded-xl p-3 text-left transition",
                    formKind === "CSQ"
                      ? "border-2 border-green-600 bg-green-50/40"
                      : "border border-slate-200 bg-white hover:border-slate-300"
                  )}
                >
                  <div className="flex w-full items-center justify-between">
                    <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-semibold text-green-700">CSQ</span>
                    {formKind === "CSQ" && <CheckCircle size={14} weight="fill" className="text-green-600" />}
                  </div>
                  <p className="mt-2 text-xs font-semibold text-slate-900">Teks Bebas</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">Dalam window 24 jam</p>
                </button>
                <button
                  type="button"
                  onClick={() => setFormKind("META")}
                  className={cn(
                    "flex flex-col items-start rounded-xl p-3 text-left transition",
                    formKind === "META"
                      ? "border-2 border-blue-600 bg-blue-50/40"
                      : "border border-slate-200 bg-white hover:border-slate-300"
                  )}
                >
                  <div className="flex w-full items-center justify-between">
                    <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">Meta</span>
                    {formKind === "META" && <CheckCircle size={14} weight="fill" className="text-blue-600" />}
                  </div>
                  <p className="mt-2 text-xs font-semibold text-slate-900">Template Meta</p>
                  <p className="mt-0.5 text-[11px] text-slate-500">Approved di luar 24 jam</p>
                </button>
              </div>
            </div>

            {/* Fungsi template */}
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Fungsi Template</label>
              <select
                value={keyOption}
                onChange={(e) => setKeyOption(e.target.value)}
                className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-900 focus:border-slate-400 focus:outline-none"
              >
                {systemKeys.map((k) => (
                  <option
                    key={k.key}
                    value={`sys:${k.key}`}
                    disabled={usedKeys.includes(k.key) && `sys:${k.key}` !== keyOption}
                  >
                    {k.label}
                  </option>
                ))}
                <option value="custom">Lainnya (buat fungsi sendiri)</option>
              </select>
              {selectedSys && (
                <p className="mt-1.5 rounded-lg bg-slate-50 p-2 text-xs text-slate-500">
                  {selectedSys.description}
                </p>
              )}
              {keyOption === "custom" && (
                <div className="mt-2">
                  <label className="mb-1 block text-[11px] font-medium text-slate-500">
                    Identifier / Key Unik
                  </label>
                  <input
                    value={customKey}
                    onChange={(e) => setCustomKey(e.target.value)}
                    placeholder="mis. promo_akhir_pekan"
                    pattern="[a-z0-9_]+"
                    title="huruf kecil, angka, underscore"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-slate-900 focus:border-slate-400 focus:outline-none"
                  />
                </div>
              )}
            </div>

            {/* Nama label */}
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-700">Nama Tampilan</label>
              <input
                required
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Mis. Pesan penutup sesi"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
              />
            </div>

            {/* CSQ body */}
            {formKind === "CSQ" && (
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="block text-xs font-medium text-slate-700">Isi Pesan</label>
                  <span className="font-mono text-[11px] tabular-nums text-slate-400">
                    {body.length} karakter
                  </span>
                </div>
                <textarea
                  required
                  rows={4}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="Teks pesan yang dikirim ke pelanggan…"
                  className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-900 focus:border-slate-400 focus:outline-none"
                />
              </div>
            )}

            {/* Meta fields */}
            {formKind === "META" && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Nama Template Meta</label>
                  <input
                    required
                    value={metaName}
                    onChange={(e) => setMetaName(e.target.value)}
                    placeholder="mis. session_close_v1"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-slate-900 focus:border-slate-400 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Kode Bahasa</label>
                  <input
                    value={metaLang}
                    onChange={(e) => setMetaLang(e.target.value)}
                    placeholder="id"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-slate-900 focus:border-slate-400 focus:outline-none"
                  />
                </div>
              </div>
            )}

            {/* Live bubble preview */}
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50/70">
              <div className="flex items-center justify-between border-b border-slate-200/80 px-3.5 py-2 text-[11px] font-medium text-slate-500">
                <span className="flex items-center gap-1.5">
                  <WhatsappLogo size={13} weight="fill" className="text-green-600" /> Pratinjau Tampilan
                </span>
                <span className="font-mono text-[10px] text-slate-400">
                  {formKind === "CSQ"
                    ? "CSQ - 24 Jam"
                    : `Meta - ${(metaLang || "id").toUpperCase()}`}
                </span>
              </div>
              <div className="p-3.5">
                {formKind === "CSQ" ? (
                  <div className="ml-auto max-w-[90%] whitespace-pre-line rounded-xl rounded-tr-xs border border-green-200 bg-green-50 p-3 text-xs leading-relaxed text-slate-800 shadow-xs">
                    {body.trim() || "Pratinjau isi pesan CSQ akan tampil di sini..."}
                  </div>
                ) : (
                  <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-3 font-mono text-xs text-blue-900">
                    Meta Template: {metaName.trim() || "nama_template_meta"} [{metaLang.trim() || "id"}]
                  </div>
                )}
              </div>
            </div>
          </div>
          <DrawerFooter>
            <button
              type="button"
              onClick={() => setDrawer(null)}
              className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-green-700 disabled:opacity-50"
            >
              <CheckCircle size={14} /> {busy ? "Menyimpan..." : "Simpan Template"}
            </button>
          </DrawerFooter>
        </form>
      </Drawer>

      {/* ═══════════ Delete Drawer ═══════════ */}
      <Drawer
        open={drawer === "del"}
        onClose={() => setDrawer(null)}
        title="Hapus Template"
        maxWidth="max-w-md"
      >
        <div className="flex-1 p-6">
          {drawerError && <FormError msg={drawerError} />}
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-red-50 text-red-600">
            <Warning size={22} />
          </div>
          <h4 className="mt-4 text-sm font-semibold text-slate-900">Hapus template ini?</h4>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Yakin ingin menghapus template <strong>&quot;{delTarget?.label}&quot;</strong>?
          </p>
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            Jika template ini dipakai oleh otomasi sistem atau kampanye aktif,
            sistem akan kembali ke pesan default.
          </div>
        </div>
        <DrawerFooter>
          <button
            type="button"
            onClick={() => setDrawer(null)}
            className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={() => void confirmDelete()}
            disabled={busy}
            className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
          >
            {busy ? "Menghapus..." : "Ya, Hapus"}
          </button>
        </DrawerFooter>
      </Drawer>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-lg bg-slate-900 px-3.5 py-2.5 text-xs font-medium text-white shadow-lg">
          <CheckCircle size={14} weight="fill" className="text-green-400" />
          {toast}
        </div>
      )}
    </DashboardShell>
  );
}

// ── Sub-components ──

function StatCard(props: {
  label: string;
  value: number;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3.5 shadow-xs">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-slate-500">{props.label}</p>
        {props.icon ?? props.badge}
      </div>
      <p className="mt-1.5 text-2xl font-bold tabular-nums text-slate-900">{props.value}</p>
    </div>
  );
}

function FormError({ msg }: { msg: string }) {
  return (
    <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs font-medium text-red-600">
      {msg}
    </p>
  );
}

function Drawer(props: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  maxWidth?: string;
  children: React.ReactNode;
}) {
  if (!props.open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-950/30"
      style={{ animation: "tplFadeIn 0.15s ease-out" }}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <style>{`@keyframes tplFadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes tplSlideIn { from { transform: translateX(24px) } to { transform: translateX(0) } }`}</style>
      <div
        className={cn(
          "flex h-full w-full flex-col border-l border-slate-200 bg-white shadow-2xl",
          props.maxWidth ?? "max-w-lg"
        )}
        style={{ animation: "tplSlideIn 0.18s cubic-bezier(0.16, 1, 0.3, 1)" }}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">{props.title}</h3>
            {props.subtitle && <p className="text-xs text-slate-500">{props.subtitle}</p>}
          </div>
          <button
            onClick={props.onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            aria-label="Tutup"
          >
            <X size={16} />
          </button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

function DrawerFooter({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/60 px-6 py-4">
      {children}
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth(async () => ({
  props: {},
}));
