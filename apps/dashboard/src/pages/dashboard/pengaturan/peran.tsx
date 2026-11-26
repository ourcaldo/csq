// /dashboard/pengaturan/peran - PRD 29 role management, ported from the
// owner's reference docs/demo/enterprise_roles_permissions_rbac.html
// (2026-11-23): enterprise role directory (metric strip, segmented tabs,
// search + sort, full-width table with coverage bars) and a full-page
// two-column editor (sticky action header, inline policy diff, domain
// rail with jump links + bulk presets, per-feature level controls, granular
// scope grid). No modals, no collapsibles. Two-step inline confirms only.
import { useMemo, useState } from "react";
import type { Dispatch, FormEvent, SetStateAction } from "react";
import type { GetServerSideProps } from "next";
import {
  ArrowLeft,
  CheckCircle,
  CopySimple,
  MagnifyingGlass,
  Plus,
  TrashSimple,
  UsersThree,
} from "@phosphor-icons/react";
import { withAuth } from "@csq/core/lib/auth";
import {
  ALL_KEYS,
  FEATURE_GROUPS,
  PERMISSION_FEATURES,
  PERMISSION_GROUPS,
  featureLevel,
  type FeatureLevel,
  type PermissionFeature,
  type PermissionKey,
} from "@csq/core/lib/permissions-catalog";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { FlushPage } from "@/components/dashboard/flush-page";
import { ReadOnlyBanner, useCanEdit } from "@/components/dashboard/settings/settings-access";
import { cn } from "@csq/ui/lib/utils";

type RoleItem = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  userCount: number;
  createdAt: string;
  updatedAt: string;
};

const KEY_LABELS: Record<string, string> = Object.fromEntries(
  PERMISSION_GROUPS.flatMap((g) => g.keys.map((k) => [k.key, k.label]))
);

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function groupSummary(perms: string[]) {
  const set = new Set(perms);
  return FEATURE_GROUPS.map((g) => {
    const feats = PERMISSION_FEATURES.filter((f) => f.group === g);
    const total = feats.reduce((n, f) => n + f.keys.length, 0);
    const granted = feats.reduce((n, f) => n + f.keys.filter((k) => set.has(k)).length, 0);
    return { g, granted, total };
  }).filter((s) => s.granted > 0);
}

export default function PengaturanPeranPage() {
  const canEdit = useCanEdit("peran.kelola");
  const { data, loading, error, refresh } = useApi<{ items: RoleItem[] }>(
    "/api/dashboard/roles"
  );
  const roles = useMemo(() => data?.items ?? [], [data]);
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [confirmDeleteCardId, setConfirmDeleteCardId] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function duplicateRole(role: RoleItem) {
    let n = 2;
    let candidate = `${role.name} (Salinan)`;
    const names = new Set(roles.map((r) => r.name));
    while (names.has(candidate)) {
      n += 1;
      candidate = `${role.name} (Salinan ${n})`;
    }
    try {
      await apiSend<RoleItem>("/api/dashboard/roles", "POST", {
        name: candidate,
        description: role.description ?? undefined,
        permissions: role.permissions,
      });
      refresh();
      showToast(`Peran diduplikasi sebagai "${candidate}".`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Gagal menduplikasi peran.");
    }
  }

  async function deleteRole(id: string) {
    try {
      await apiSend(`/api/dashboard/roles/${id}`, "DELETE");
      setConfirmDeleteCardId(null);
      refresh();
      showToast("Peran dihapus.");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Gagal menghapus peran.");
    }
  }

  if (editing !== null && canEdit) {
    const role = editing === "new" ? null : roles.find((r) => r.id === editing) ?? null;
    return (
      <DashboardShell title="Peran & Izin" flush>
        <FlushPage>
          <RoleEditor
            role={role}
            onDone={(msg) => {
              setEditing(null);
              refresh();
              if (msg) showToast(msg);
            }}
            onForceClose={() => setEditing(null)}
            showToast={showToast}
          />
          {toast && <ToastBar msg={toast} />}
        </FlushPage>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell title="Peran & Izin" flush>
      <FlushPage>
        {/* Page title & primary CTA */}
        <div className="flex flex-col justify-between gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end">
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-semibold tracking-tight text-slate-900">
                Peran &amp; Kontrol Akses (RBAC)
              </h1>
              <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] font-medium text-slate-600">
                {ALL_KEYS.length} Granular Scopes
              </span>
            </div>
            <p className="mt-1.5 max-w-3xl text-xs leading-relaxed text-slate-500">
              Kelola kebijakan keamanan dan matriks hak akses tim. Peran bawaan sistem
              memiliki struktur perlindungan terhadap penghapusan, namun cakupan
              izinnya tetap dapat disesuaikan.
            </p>
          </div>
          {canEdit ? (
            <button
              type="button"
              onClick={() => setEditing("new")}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-green-600 px-4 text-xs font-semibold text-white shadow-xs transition hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
            >
              <Plus size={14} />
              Buat Peran Kustom
            </button>
          ) : undefined}
        </div>
        {!canEdit && (
          <div className="pt-4">
            <ReadOnlyBanner />
          </div>
        )}
        <RoleDirectory
          roles={roles}
          loading={loading}
          error={error}
          canEdit={canEdit}
          confirmDeleteCardId={confirmDeleteCardId}
          onRequestDelete={(id) => setConfirmDeleteCardId(id)}
          onCancelDelete={() => setConfirmDeleteCardId(null)}
          onConfirmDelete={(id) => void deleteRole(id)}
          onDuplicate={(r) => void duplicateRole(r)}
          onOpen={(id) => setEditing(id)}
        />
        {toast && <ToastBar msg={toast} />}
      </FlushPage>
    </DashboardShell>
  );
}

// ─── View 1: role directory table ───

type SortMode = "default" | "members" | "perms" | "name";

function RoleDirectory({
  roles,
  loading,
  error,
  canEdit,
  confirmDeleteCardId,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  onDuplicate,
  onOpen,
}: {
  roles: RoleItem[];
  loading: boolean;
  error: string | null;
  canEdit: boolean;
  confirmDeleteCardId: string | null;
  onRequestDelete: (id: string) => void;
  onCancelDelete: () => void;
  onConfirmDelete: (id: string) => void;
  onDuplicate: (role: RoleItem) => void;
  onOpen: (id: string) => void;
}) {
  const [filter, setFilter] = useState<"ALL" | "SYSTEM" | "CUSTOM">("ALL");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<SortMode>("default");

  const kpis = {
    total: roles.length,
    assignments: roles.reduce((n, r) => n + r.userCount, 0),
    system: roles.filter((r) => r.isSystem).length,
    avg: roles.length
      ? Math.round(roles.reduce((n, r) => n + r.permissions.length, 0) / roles.length)
      : 0,
  };

  const q = search.trim().toLowerCase();
  let filtered = roles.filter((r) => {
    const okFilter = filter === "ALL" || (filter === "SYSTEM" ? r.isSystem : !r.isSystem);
    const okQ =
      !q ||
      r.name.toLowerCase().includes(q) ||
      (r.description ?? "").toLowerCase().includes(q) ||
      r.permissions.some((k) => k.toLowerCase().includes(q));
    return okFilter && okQ;
  });
  if (sort === "members") filtered = [...filtered].sort((a, b) => b.userCount - a.userCount);
  else if (sort === "perms") filtered = [...filtered].sort((a, b) => b.permissions.length - a.permissions.length);
  else if (sort === "name") filtered = [...filtered].sort((a, b) => a.name.localeCompare(b.name));

  const tabs: { key: "ALL" | "SYSTEM" | "CUSTOM"; label: string; count: number }[] = [
    { key: "ALL", label: "Semua Peran", count: roles.length },
    { key: "SYSTEM", label: "Bawaan Sistem", count: kpis.system },
    { key: "CUSTOM", label: "Kustom", count: roles.length - kpis.system },
  ];

  return (
    <div>
      {/* Edge-to-edge metric strip */}
      <div className="grid grid-cols-2 border-b border-slate-200 sm:grid-cols-4 sm:divide-x sm:divide-slate-200">
        <Metric label="Total Definisi Peran" value={kpis.total} hint="aktif dalam workspace" />
        <Metric label="Anggota Tertaut" value={kpis.assignments} hint="kursi teralokasi" />
        <Metric label="Peran Bawaan Sistem" value={kpis.system} hint="dilindungi sistem" tone="brand" />
        <Metric label="Cakupan Rata-rata" value={kpis.avg} hint="izin / peran" />
      </div>

      {/* Filter & search bar */}
      <div className="flex flex-col justify-between gap-3 border-b border-slate-200 py-4 sm:flex-row sm:items-center">
        <div className="inline-flex rounded-lg bg-slate-100 p-1" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              onClick={() => setFilter(t.key)}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs transition",
                filter === t.key
                  ? "bg-white font-semibold text-slate-900 shadow-2xs"
                  : "font-medium text-slate-600 hover:text-slate-900"
              )}
            >
              {t.label}
              <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                {t.count}
              </span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2.5">
          <div className="relative flex-1 sm:w-72">
            <MagnifyingGlass
              size={14}
              weight="bold"
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              type="text"
              placeholder="Cari nama peran, deskripsi, atau scope..."
              className="h-8 w-full rounded-lg border border-slate-200 bg-slate-50/70 pl-8 pr-3 text-xs text-slate-800 placeholder-slate-400 transition focus:border-green-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-500/15"
            />
          </div>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value === "members" || e.target.value === "perms" || e.target.value === "name" ? e.target.value : "default")}
            className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 focus:border-green-500 focus:outline-none"
          >
            <option value="default">Urutan Default</option>
            <option value="members">Anggota Terbanyak</option>
            <option value="perms">Izin Terbanyak</option>
            <option value="name">Nama (A-Z)</option>
          </select>
        </div>
      </div>

      {/* Role table */}
      {error && <p className="py-6 text-sm text-red-600">{error}</p>}
      {loading && <p className="py-6 text-sm text-slate-500">Memuat peran...</p>}
      {!loading && (
        <div className="overflow-x-auto border-b border-slate-200">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/60 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <th className="py-3 pr-4">Definisi Peran</th>
                <th className="px-4 py-3">Cakupan &amp; Domain Akses</th>
                <th className="px-4 py-3 text-right">Anggota</th>
                <th className="px-4 py-3">Diperbarui</th>
                <th className="py-3 pl-4 text-right">Tindakan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200/80">
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-14 text-center">
                    <p className="text-sm font-medium text-slate-700">
                      Tidak ada definisi peran yang sesuai
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      Coba ubah kata kunci pencarian atau reset filter kategori peran.
                    </p>
                  </td>
                </tr>
              )}
              {filtered.map((r) => {
                const pct = Math.round((r.permissions.length / ALL_KEYS.length) * 100);
                const confirming = confirmDeleteCardId === r.id;
                return (
                  <tr key={r.id} className="group transition-colors hover:bg-slate-50/70">
                    <td className="max-w-md py-4 pr-4 align-top">
                      <div className="flex flex-wrap items-center gap-2">
                        {canEdit ? (
                          <button
                            type="button"
                            onClick={() => onOpen(r.id)}
                            className="text-left text-xs font-semibold text-slate-900 hover:text-green-700 hover:underline"
                          >
                            {r.name}
                          </button>
                        ) : (
                          <span className="text-left text-xs font-semibold text-slate-900">
                            {r.name}
                          </span>
                        )}
                        {r.isSystem ? (
                          <span className="inline-flex items-center rounded border border-green-200 bg-green-50 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-green-700">
                            BAWAAN
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 font-mono text-[9px] font-medium text-slate-500">
                            KUSTOM
                          </span>
                        )}
                      </div>
                      <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-slate-500">
                        {r.description ?? "Tidak ada deskripsi kebijakan."}
                      </p>
                    </td>
                    <td className="max-w-lg px-4 py-4 align-top">
                      <div className="flex items-center gap-2.5">
                        <div className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={cn("h-full rounded-full", r.isSystem ? "bg-green-600" : "bg-slate-700")}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="font-mono text-[11px] font-medium text-slate-700">
                          {r.permissions.length}/{ALL_KEYS.length}{" "}
                          <span className="text-slate-400">({pct}%)</span>
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {groupSummary(r.permissions).map((s) => (
                          <span
                            key={s.g}
                            className={cn(
                              "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px]",
                              s.granted === s.total
                                ? "border-green-200 bg-green-50/80 font-medium text-green-700"
                                : "border-slate-200 bg-slate-50 text-slate-600"
                            )}
                          >
                            <span>{s.g}</span>
                            <span className="opacity-70">{s.granted}/{s.total}</span>
                          </span>
                        ))}
                        {groupSummary(r.permissions).length === 0 && (
                          <span className="text-[11px] italic text-slate-400">
                            Tidak ada scope izin yang aktif
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 text-right align-top">
                      <div className="inline-flex items-center gap-1.5 rounded-md border border-slate-200/80 bg-slate-50/80 px-2 py-1 text-slate-600">
                        <UsersThree size={12} className="text-slate-400" />
                        <span className="font-mono text-xs font-semibold text-slate-800">{r.userCount}</span>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-4 align-top">
                      <span className="font-mono text-[11px] text-slate-500">{fmtDate(r.updatedAt)}</span>
                    </td>
                    <td className="whitespace-nowrap py-4 pl-4 text-right align-top">
                      {canEdit ? (
                      <div className="inline-flex items-center justify-end gap-1.5">
                        {confirming ? (
                          <>
                            <button
                              type="button"
                              onClick={() => onConfirmDelete(r.id)}
                              className="inline-flex h-7 items-center rounded-md bg-rose-600 px-2.5 text-[11px] font-semibold text-white transition hover:bg-rose-700"
                            >
                              Konfirmasi Hapus
                            </button>
                            <button
                              type="button"
                              onClick={onCancelDelete}
                              className="inline-flex h-7 items-center rounded-md border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                            >
                              Batal
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => onDuplicate(r)}
                              title="Duplikasi peran"
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900"
                            >
                              <CopySimple size={14} />
                            </button>
                            {!r.isSystem && (
                              <button
                                type="button"
                                onClick={() => onRequestDelete(r.id)}
                                disabled={r.userCount > 0}
                                title={r.userCount > 0 ? "Tidak dapat dihapus: masih memiliki anggota aktif" : "Hapus peran kustom"}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <TrashSimple size={14} />
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => onOpen(r.id)}
                              className="ml-1 inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-800 transition hover:border-green-600 hover:bg-green-600 hover:text-white"
                            >
                              <span>Konfigurasi</span>
                              <ArrowLeft size={12} className="rotate-180" />
                            </button>
                          </>
                        )}
                      </div>
                      ) : (
                        <span className="text-[11px] text-slate-400">Lihat saja</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint: string;
  tone?: "brand";
}) {
  return (
    <div className="border-t border-slate-200 py-5 pr-6 sm:border-t-0 sm:px-6 sm:first:pl-0 sm:first:pr-6">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <span
          className={cn(
            "font-mono text-2xl font-semibold tracking-tight",
            tone === "brand" ? "text-green-700" : "text-slate-900"
          )}
        >
          {value}
        </span>
        <span className="text-[11px] text-slate-400">{hint}</span>
      </div>
    </div>
  );
}

// ─── View 2: full-page role & permission matrix editor ───

function RoleEditor({
  role,
  onDone,
  onForceClose,
  showToast,
}: {
  role: RoleItem | null;
  onDone: (msg?: string) => void;
  onForceClose: () => void;
  showToast: (msg: string) => void;
}) {
  const creating = role === null;
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [perms, setPerms] = useState<Set<PermissionKey>>(new Set(role?.permissions ?? []));
  const [permSearch, setPermSearch] = useState("");
  const [onlyActive, setOnlyActive] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const baseline = useMemo(
    () =>
      JSON.stringify({
        name: role?.name ?? "",
        desc: role?.description ?? "",
        perms: [...(role?.permissions ?? [])].sort(),
      }),
    [role]
  );
  const current = JSON.stringify({ name, desc: description, perms: [...perms].sort() });
  const dirty = current !== baseline;

  const added = useMemo(
    () => [...perms].filter((k) => !(role?.permissions ?? []).includes(k)),
    [perms, role]
  );
  const removed = useMemo(
    () => (role?.permissions ?? []).filter((k) => !perms.has(k)),
    [perms, role]
  );

  function mutatePerms(fn: (next: Set<PermissionKey>) => void) {
    setPerms((prev) => {
      const next = new Set(prev);
      fn(next);
      return next;
    });
    setConfirmDiscard(false);
  }

  function applyLevel(feature: PermissionFeature, level: "off" | "baca" | "edit" | "penuh") {
    mutatePerms((next) => {
      for (const k of feature.keys) next.delete(k);
      const add =
        level === "penuh" ? feature.keys : level === "edit" ? feature.edit : level === "baca" ? feature.baca : [];
      for (const k of add) next.add(k);
    });
  }

  // Key set a bulk preset produces over a set of features (mirrors the
  // feature-level rules: penuh = all keys, baca = baca set or the .lihat
  // fallback for single-key features).
  function presetKeysFor(feats: PermissionFeature[], level: "baca" | "penuh"): PermissionKey[] {
    const out = new Set<PermissionKey>();
    for (const f of feats) {
      if (level === "penuh") {
        for (const k of f.keys) out.add(k);
      } else {
        const baca = f.baca.length ? f.baca : f.keys.filter((k) => k.endsWith(".lihat"));
        for (const k of baca) out.add(k);
      }
    }
    return [...out];
  }

  // A preset is ACTIVE when the granted keys inside its universe are
  // exactly its key set (so the button lights up after applying it, and
  // dims again on any manual change).
  function presetActive(
    preset: readonly PermissionKey[],
    universe: readonly PermissionKey[],
    scope: Set<PermissionKey>
  ): boolean {
    const granted = universe.filter((k) => scope.has(k));
    return granted.length === preset.length && preset.every((k) => scope.has(k));
  }

  function applyGroupLevel(group: string, level: "off" | "baca" | "penuh") {
    const feats = PERMISSION_FEATURES.filter((f) => f.group === group);
    const preset = level === "off" ? [] : presetKeysFor(feats, level);
    mutatePerms((next) => {
      for (const f of feats) {
        for (const k of f.keys) next.delete(k);
      }
      for (const k of preset) next.add(k);
    });
  }

  function applyGlobalPreset(mode: "off" | "baca" | "penuh") {
    const preset = mode === "off" ? [] : presetKeysFor([...PERMISSION_FEATURES], mode);
    mutatePerms((next) => {
      next.clear();
      for (const k of preset) next.add(k);
    });
  }

  function attemptClose() {
    if (dirty && !confirmDiscard) {
      setConfirmDiscard(true);
      showToast("Ada perubahan belum disimpan. Klik lagi untuk membatalkan.");
      return;
    }
    onForceClose();
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy || !name.trim()) return;
    setBusy(true);
    setFormError(null);
    try {
      if (creating) {
        await apiSend<RoleItem>("/api/dashboard/roles", "POST", {
          name,
          description: description || undefined,
          permissions: [...perms],
        });
        onDone(`Peran "${name}" berhasil diterbitkan.`);
      } else if (role) {
        await apiSend<RoleItem>(`/api/dashboard/roles/${role.id}`, "PUT", {
          name,
          description: description || null,
          permissions: [...perms],
        });
        onDone(`Perubahan pada "${role.name}" disimpan.`);
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal menyimpan peran.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSelf() {
    if (!role) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    try {
      await apiSend(`/api/dashboard/roles/${role.id}`, "DELETE");
      onDone("Peran dihapus.");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal menghapus peran.");
      setConfirmDelete(false);
      setBusy(false);
    }
  }

  const q = permSearch.trim().toLowerCase();

  return (
    <form onSubmit={save}>
      {/* Sticky action header */}
      <div className="sticky top-0 z-20 -mx-4 border-b border-slate-200 bg-white/95 px-4 py-4 backdrop-blur-md md:-mx-8 md:px-8">
        <div className="flex w-full flex-col justify-between gap-4 md:flex-row md:items-center">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={attemptClose}
                className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
              >
                <ArrowLeft size={14} />
                Kembali
              </button>
              {role?.isSystem && (
                <span className="inline-flex items-center rounded border border-green-200 bg-green-50 px-2 py-0.5 font-mono text-[10px] font-semibold text-green-700">
                  SYSTEM ROLE
                </span>
              )}
              <span
                className={cn(
                  "inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[11px] font-medium",
                  dirty
                    ? "border-amber-200 bg-amber-50 text-amber-800"
                    : "border-slate-200 bg-slate-50 text-slate-500"
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", dirty ? "bg-amber-500" : "bg-emerald-500")} />
                {dirty ? "Perubahan belum disimpan" : "Tersimpan"}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <input
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setConfirmDiscard(false);
                }}
                maxLength={60}
                required
                disabled={!!role?.isSystem}
                placeholder="Masukkan nama peran (mis. Supervisor Operasional)"
                className="w-full max-w-lg rounded-md border border-transparent bg-transparent px-1 text-lg font-semibold tracking-tight text-slate-900 transition placeholder:text-slate-400 hover:border-slate-200 hover:bg-slate-50 focus:border-green-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-500/15 disabled:cursor-not-allowed disabled:opacity-80"
              />
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-slate-500">
              <span>{role ? `ID: ${role.id.slice(0, 8)}` : "ID: Draft Baru"}</span>
              <span>{role ? `Dibuat ${fmtDate(role.createdAt)}` : "Belum diterbitkan"}</span>
              <span className="font-semibold text-green-700">
                {perms.size} / {ALL_KEYS.length} scope aktif
              </span>
              <span>{role ? `${role.userCount} anggota aktif` : "0 anggota"}</span>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {!creating && dirty && (
              <button
                type="button"
                onClick={() => setDiffOpen((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 transition hover:bg-amber-100"
              >
                {diffOpen ? "Sembunyikan Diff" : "Lihat Diff"}
              </button>
            )}
            <button
              type="button"
              onClick={attemptClose}
              className={cn(
                "rounded-lg px-3.5 py-2 text-xs transition",
                confirmDiscard
                  ? "border border-rose-300 bg-rose-50 font-semibold text-rose-700 hover:bg-rose-100"
                  : "border border-slate-300 bg-white font-medium text-slate-700 hover:bg-slate-50"
              )}
            >
              {confirmDiscard ? "Konfirmasi Buang Perubahan" : "Batal"}
            </button>
            <button
              type="submit"
              disabled={busy || !name.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-xs font-semibold text-white shadow-xs transition hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-60"
            >
              {busy ? "Menyimpan..." : creating ? "Terbitkan Peran" : "Simpan Perubahan"}
            </button>
          </div>
        </div>
      </div>

      {/* Inline policy diff strip */}
      {diffOpen && dirty && (
        <div className="fade-in border-b border-amber-200 bg-amber-50/40 py-4">
          <div className="flex items-center justify-between pb-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-amber-950">Ringkasan Perubahan Kebijakan</span>
              <span className="rounded border border-amber-200 bg-white px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-800">
                +{added.length} ditambahkan / -{removed.length} dicabut
              </span>
            </div>
            <button
              type="button"
              onClick={() => setDiffOpen(false)}
              className="text-xs font-medium text-amber-800 hover:text-amber-950"
            >
              Sembunyikan
            </button>
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            <div>
              <p className="text-[11px] font-semibold text-emerald-800">
                Scope Ditambahkan ({added.length})
              </p>
              {added.length ? (
                <div className="mt-2 divide-y divide-amber-200/50 border-t border-amber-200/60">
                  {added.map((k) => (
                    <div key={k} className="flex items-center justify-between py-1.5 font-mono text-[11px] text-emerald-800">
                      <span>+ {k}</span>
                      <span className="text-slate-500">{KEY_LABELS[k] ?? ""}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-1.5 text-[11px] text-slate-500">Tidak ada scope baru ditambahkan.</p>
              )}
            </div>
            <div>
              <p className="text-[11px] font-semibold text-rose-800">Scope Dicabut ({removed.length})</p>
              {removed.length ? (
                <div className="mt-2 divide-y divide-amber-200/50 border-t border-amber-200/60">
                  {removed.map((k) => (
                    <div key={k} className="flex items-center justify-between py-1.5 font-mono text-[11px] text-rose-700">
                      <span>- {k}</span>
                      <span className="text-slate-500">{KEY_LABELS[k] ?? ""}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-1.5 text-[11px] text-slate-500">Tidak ada scope yang dicabut.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Two-column workspace */}
      <div className="grid grid-cols-1 lg:grid-cols-12">
        {/* Left rail */}
        <aside className="border-b border-slate-200 py-6 lg:col-span-3 lg:border-b-0 lg:border-r lg:pr-6">
          <div className="space-y-6 lg:sticky lg:top-40">
            <div>
              <p className="pb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Domain Modul
              </p>
              <nav className="space-y-0.5">
                {FEATURE_GROUPS.map((g, idx) => {
                  const feats = PERMISSION_FEATURES.filter((f) => f.group === g);
                  const total = feats.reduce((n, f) => n + f.keys.length, 0);
                  const granted = feats.reduce((n, f) => n + f.keys.filter((k) => perms.has(k)).length, 0);
                  return (
                    <a
                      key={g}
                      href={`#domain-${idx}`}
                      className="flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                    >
                      <span className="truncate">{g}</span>
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 font-mono text-[10px]",
                          granted > 0 ? "bg-green-50 font-semibold text-green-700" : "text-slate-400"
                        )}
                      >
                        {granted}/{total}
                      </span>
                    </a>
                  );
                })}
              </nav>
            </div>

            <div className="border-t border-slate-200 pt-5">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Preset Kebijakan Cepat
              </p>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                Terapkan template izin ke seluruh domain secara massal.
              </p>
              <div className="mt-3 space-y-1.5">
                <button
                  type="button"
                  onClick={() => applyGlobalPreset("baca")}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg border px-2.5 py-1.5 text-left text-xs font-medium transition",
                    presetActive(presetKeysFor([...PERMISSION_FEATURES], "baca"), ALL_KEYS, perms)
                      ? "border-green-600 bg-green-50 text-green-700"
                      : "border-slate-200 bg-slate-50/60 text-slate-700 hover:border-slate-300 hover:bg-white"
                  )}
                >
                  <span>Hanya Baca (Auditor)</span>
                  <span className="font-mono text-[10px] text-slate-400">READ</span>
                </button>
                <button
                  type="button"
                  onClick={() => applyGlobalPreset("penuh")}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg border px-2.5 py-1.5 text-left text-xs font-medium transition",
                    presetActive(presetKeysFor([...PERMISSION_FEATURES], "penuh"), ALL_KEYS, perms)
                      ? "border-green-600 bg-green-50 text-green-700"
                      : "border-slate-200 bg-slate-50/60 text-slate-700 hover:border-slate-300 hover:bg-white"
                  )}
                >
                  <span>Akses Penuh Semua</span>
                  <span className="font-mono text-[10px] text-green-600">ALL</span>
                </button>
                <button
                  type="button"
                  onClick={() => applyGlobalPreset("off")}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg border px-2.5 py-1.5 text-left text-xs font-medium transition",
                    perms.size === 0
                      ? "border-rose-300 bg-rose-50 text-rose-700"
                      : "border-slate-200 bg-slate-50/60 text-rose-600 hover:border-rose-200 hover:bg-rose-50/50"
                  )}
                >
                  <span>Cabut Semua Izin</span>
                  <span className="font-mono text-[10px] text-rose-400">NONE</span>
                </button>
              </div>
            </div>

            {role && !role.isSystem && (
              <div className="border-t border-slate-200 pt-5">
                <p className="text-xs font-semibold text-rose-900">Zona Berbahaya</p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                  Penghapusan peran bersifat permanen dan hanya dapat dilakukan jika tidak
                  ada anggota tertaut.
                </p>
                <div className="mt-3 flex flex-col gap-1.5">
                  <button
                    type="button"
                    onClick={() => void deleteSelf()}
                    disabled={busy || role.userCount > 0}
                    className={cn(
                      "inline-flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
                      confirmDelete
                        ? "border-transparent bg-rose-600 font-semibold text-white hover:bg-rose-700"
                        : "border-rose-200 bg-rose-50/40 text-rose-600 hover:bg-rose-600 hover:text-white"
                    )}
                  >
                    <TrashSimple size={14} />
                    {confirmDelete
                      ? "Klik Lagi untuk Konfirmasi"
                      : role.userCount > 0
                        ? `Terkunci (${role.userCount} anggota)`
                        : "Hapus Peran Ini"}
                  </button>
                  {confirmDelete && (
                    <button
                      type="button"
                      onClick={() => setConfirmDelete(false)}
                      className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Batalkan Penghapusan
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </aside>

        {/* Right main content */}
        <div className="py-6 lg:col-span-9 lg:pl-8">
          {/* Identity */}
          <section className="border-b border-slate-200 pb-6">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
              <div>
                <h2 className="text-sm font-semibold text-slate-900">Identitas &amp; Deskripsi Peran</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Jelaskan tanggung jawab operasional peran ini untuk memudahkan audit
                  internal dan onboarding anggota.
                </p>
              </div>
              {role?.isSystem && (
                <p className="shrink-0 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] text-slate-500">
                  Nama peran bawaan dikunci oleh sistem
                </p>
              )}
            </div>
            <div className="mt-4">
              <label htmlFor="f-desc" className="block text-xs font-medium text-slate-700">
                Deskripsi Singkat
              </label>
              <input
                id="f-desc"
                maxLength={200}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setConfirmDiscard(false);
                }}
                placeholder="Contoh: Operator layanan pelanggan cabang - dapat membalas chat, mengelola tiket, dan melihat katalog produk."
                className="mt-1.5 h-9 w-full rounded-lg border border-slate-200 bg-slate-50/50 px-3 text-xs text-slate-900 transition placeholder:text-slate-400 focus:border-green-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-green-500/15"
              />
            </div>
          </section>

          {/* Matrix filter bar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 py-4">
            <div className="flex items-center gap-2">
              <div className="relative">
                <MagnifyingGlass
                  size={14}
                  weight="bold"
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
                />
                <input
                  value={permSearch}
                  onChange={(e) => setPermSearch(e.target.value)}
                  type="text"
                  placeholder="Filter fitur atau scope izin..."
                  className="h-8 w-56 rounded-lg border border-slate-200 bg-slate-50 pl-8 pr-2.5 text-xs text-slate-800 placeholder-slate-400 focus:border-green-500 focus:bg-white focus:outline-none sm:w-72"
                />
              </div>
              <label className="inline-flex cursor-pointer select-none items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                <input
                  type="checkbox"
                  checked={onlyActive}
                  onChange={(e) => setOnlyActive(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-300 text-green-600 focus:ring-green-500"
                />
                <span>Hanya izin aktif</span>
              </label>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-slate-500">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-green-600" />Aktif
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-400" />Kustom Parsial
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-slate-300" />Nonaktif
              </span>
            </div>
          </div>

          {/* Permission sections */}
          <div className="divide-y divide-slate-200">
            {FEATURE_GROUPS.map((g, gIdx) => {
              const feats = PERMISSION_FEATURES.filter((f) => f.group === g);
              const total = feats.reduce((n, f) => n + f.keys.length, 0);
              const granted = feats.reduce((n, f) => n + f.keys.filter((k) => perms.has(k)).length, 0);
              const visible = feats.filter((f) => {
                const hasAny = f.keys.some((k) => perms.has(k));
                if (onlyActive && !hasAny) return false;
                if (!q) return true;
                return (
                  f.label.toLowerCase().includes(q) ||
                  f.desc.toLowerCase().includes(q) ||
                  f.keys.some(
                    (k) => k.toLowerCase().includes(q) || (KEY_LABELS[k] ?? "").toLowerCase().includes(q)
                  )
                );
              });
              if (!visible.length) return null;
              const groupUniverse = feats.flatMap((f) => [...f.keys]);
              const bacaActive = presetActive(presetKeysFor(feats, "baca"), groupUniverse, perms);
              const penuhActive = presetActive(presetKeysFor(feats, "penuh"), groupUniverse, perms);
              const offActive = groupUniverse.every((k) => !perms.has(k));
              return (
                <section key={g} id={`domain-${gIdx}`} className="scroll-mt-44 py-6 first:pt-5">
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-3">
                    <div className="flex items-center gap-2.5">
                      <h2 className="text-sm font-semibold text-slate-900">{g}</h2>
                      <span className="rounded border border-slate-200 bg-slate-50 px-2 py-0.5 font-mono text-[11px] font-medium text-slate-600">
                        {granted}/{total}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => applyGroupLevel(g, "baca")}
                        className={cn(
                          "rounded border px-2.5 py-1 text-[11px] font-medium transition",
                          bacaActive
                            ? "border-green-600 bg-green-600 text-white"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900"
                        )}
                      >
                        Baca Semua
                      </button>
                      <button
                        type="button"
                        onClick={() => applyGroupLevel(g, "penuh")}
                        className={cn(
                          "rounded border px-2.5 py-1 text-[11px] font-medium transition",
                          penuhActive
                            ? "border-green-600 bg-green-600 text-white"
                            : "border-slate-200 bg-white text-green-700 hover:border-green-300 hover:bg-green-50"
                        )}
                      >
                        Penuh Semua
                      </button>
                      <button
                        type="button"
                        onClick={() => applyGroupLevel(g, "off")}
                        className={cn(
                          "rounded border px-2.5 py-1 text-[11px] font-medium transition",
                          offActive
                            ? "border-slate-300 bg-slate-100 font-semibold text-slate-700"
                            : "border-slate-200 bg-white text-slate-400 hover:text-rose-600"
                        )}
                      >
                        Reset
                      </button>
                    </div>
                  </div>
                  <div className="divide-y divide-slate-100 border-t border-slate-200/80">
                    {visible.map((f) => (
                      <FeatureRow key={f.key} feature={f} perms={perms} onLevel={applyLevel} onToggleKey={toggleKeyFactory(setPerms, setConfirmDiscard)} />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>

          {formError && <p className="mt-4 text-sm font-medium text-red-600">{formError}</p>}
        </div>
      </div>
    </form>
  );
}

function toggleKeyFactory(
  setPerms: Dispatch<SetStateAction<Set<PermissionKey>>>,
  setConfirmDiscard: (v: boolean) => void
) {
  return (key: PermissionKey) => {
    setPerms((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setConfirmDiscard(false);
  };
}

function FeatureRow({
  feature,
  perms,
  onLevel,
  onToggleKey,
}: {
  feature: PermissionFeature;
  perms: Set<PermissionKey>;
  onLevel: (feature: PermissionFeature, level: "off" | "baca" | "edit" | "penuh") => void;
  onToggleKey: (key: PermissionKey) => void;
}) {
  const level: FeatureLevel = featureLevel(feature, perms);
  const single = feature.baca.length === 0 && feature.edit.length === 0;
  const penuhRedundant = feature.edit.length === feature.keys.length;
  const segments: { key: "off" | "baca" | "edit" | "penuh"; label: string }[] = [
    { key: "off", label: "Nonaktif" },
    ...(feature.baca.length ? [{ key: "baca" as const, label: "Baca" }] : []),
    ...(feature.edit.length ? [{ key: "edit" as const, label: "Edit" }] : []),
    ...(!penuhRedundant && feature.edit.length ? [{ key: "penuh" as const, label: "Penuh" }] : []),
  ];
  return (
    <div className="py-4 transition-colors">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-900">{feature.label}</span>
            <span className="font-mono text-[10px] text-slate-400">{feature.key}.*</span>
          </div>
          <p className="mt-0.5 text-[11px] text-slate-500">{feature.desc}</p>
        </div>
        <div className="shrink-0">
          {single ? (
            <button
              type="button"
              onClick={() => onLevel(feature, perms.has(feature.keys[0]) ? "off" : "penuh")}
              className={cn(
                "inline-flex h-7 items-center gap-1.5 rounded-md border px-3 text-[11px] font-semibold transition",
                perms.has(feature.keys[0])
                  ? "border-green-600 bg-green-600 text-white"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", perms.has(feature.keys[0]) ? "bg-white" : "bg-slate-300")} />
              {perms.has(feature.keys[0]) ? "Diizinkan" : "Nonaktif"}
            </button>
          ) : (
            <div className="flex items-center gap-2">
              {level === "kustom" && (
                <span className="rounded border border-amber-300 bg-amber-50 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-800">
                  KUSTOM
                </span>
              )}
              <div className="inline-flex rounded-md border border-slate-200 bg-slate-100/80 p-0.5">
                {segments.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    onClick={() => onLevel(feature, s.key)}
                    className={cn(
                      "seg-btn rounded px-2.5 py-1 text-[11px] transition",
                      level === s.key
                        ? "bg-white font-semibold text-slate-900 shadow-2xs"
                        : "font-medium text-slate-500 hover:text-slate-800"
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Granular scope grid */}
      <div className="mt-3.5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {feature.keys.map((k) => {
          const active = perms.has(k);
          return (
            <button
              key={k}
              type="button"
              onClick={() => onToggleKey(k)}
              className={cn(
                "flex cursor-pointer items-center justify-between gap-2 rounded-lg border px-3 py-2 transition-colors select-none",
                active
                  ? "border-green-200 bg-green-50/50 text-slate-900"
                  : "border-slate-200/80 bg-slate-50/40 text-slate-600 hover:border-slate-300 hover:bg-white"
              )}
            >
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                    active ? "border-green-600 bg-green-600 text-white" : "border-slate-300 bg-white"
                  )}
                >
                  {active && <CheckCircle size={10} weight="bold" />}
                </span>
                <span className={cn("truncate text-xs font-medium", active ? "text-slate-900" : "text-slate-600")}>
                  {KEY_LABELS[k] ?? k}
                </span>
              </div>
              <span
                className={cn(
                  "shrink-0 font-mono text-[10px]",
                  active ? "font-medium text-green-700" : "text-slate-400"
                )}
              >
                {k.split(".")[1]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ToastBar({ msg }: { msg: string }) {
  return (
    <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 rounded-lg border border-slate-800 bg-slate-900 px-4 py-2.5 text-xs font-medium text-white shadow-lg">
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
        <CheckCircle size={12} weight="bold" />
      </span>
      {msg}
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth(
  async () => ({ props: {} })
);
