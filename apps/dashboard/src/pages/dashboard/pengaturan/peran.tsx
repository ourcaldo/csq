// /dashboard/pengaturan/peran - PRD 29 role management. Two full-page views
// (no collapsibles, no modals): the role list and the role editor. Every
// feature row carries its own Baca/Edit/Penuh level control (owner
// correction 2026-11-23) with the underlying keys always visible as
// individually clickable pills.
import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { GetServerSideProps } from "next";
import {
  ArrowLeft,
  CheckCircle,
  Copy,
  MagnifyingGlass,
  Plus,
  Trash,
  Users,
} from "@phosphor-icons/react";
import { withAuth } from "@csq/core/lib/auth";
import {
  FEATURE_GROUPS,
  PERMISSION_FEATURES,
  PERMISSION_GROUPS,
  applyFeatureLevel,
  featureLevel,
  type FeatureLevel,
  type PermissionFeature,
  type PermissionKey,
} from "@csq/core/lib/permissions-catalog";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { SettingsShell } from "@/components/dashboard/settings/settings-shell";
import { cn } from "@csq/ui/lib/utils";

type RoleItem = {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: string[];
  userCount: number;
  createdAt: string;
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

export default function PengaturanPeranPage() {
  const { data, loading, error, refresh } = useApi<{ items: RoleItem[] }>(
    "/api/dashboard/roles"
  );
  const roles = useMemo(() => data?.items ?? [], [data]);

  // null = list view; "new" = create editor; a role id = edit editor.
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const [filter, setFilter] = useState<"ALL" | "SYSTEM" | "CUSTOM">("ALL");
  const [search, setSearch] = useState("");

  const [toast, setToast] = useState<string | null>(null);
  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2800);
  }

  if (editing !== null) {
    const role = editing === "new" ? null : roles.find((r) => r.id === editing) ?? null;
    return (
      <SettingsShell
        section="peran"
        title="Peran & Izin"
        description="Editor peran: atur tingkat akses setiap fitur, simpan, lalu tugaskan ke anggota tim."
      >
        <RoleEditor
          role={role}
          onDone={(msg) => {
            setEditing(null);
            refresh();
            if (msg) showToast(msg);
          }}
          onCancel={() => setEditing(null)}
        />
        {toast && <ToastBar msg={toast} />}
      </SettingsShell>
    );
  }

  const filtered = roles.filter((r) => {
    const matchFilter =
      filter === "ALL" || (filter === "SYSTEM" ? r.isSystem : !r.isSystem);
    const q = search.trim().toLowerCase();
    const matchQuery = !q || r.name.toLowerCase().includes(q) || (r.description ?? "").toLowerCase().includes(q);
    return matchFilter && matchQuery;
  });

  const kpis = {
    total: roles.length,
    assignments: roles.reduce((n, r) => n + r.userCount, 0),
    system: roles.filter((r) => r.isSystem).length,
    avgPerms: roles.length
      ? Math.round(roles.reduce((n, r) => n + r.permissions.length, 0) / roles.length)
      : 0,
  };

  async function duplicate(role: RoleItem) {
    let n = 2;
    let candidate = `${role.name} (${n})`;
    const names = new Set(roles.map((r) => r.name));
    while (names.has(candidate)) {
      n += 1;
      candidate = `${role.name} (${n})`;
    }
    try {
      await apiSend<RoleItem>("/api/dashboard/roles", "POST", {
        name: candidate,
        description: role.description ?? undefined,
        permissions: role.permissions,
      });
      showToast("Peran diduplikat.");
      refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Gagal menduplikasi peran.");
    }
  }

  async function remove(role: RoleItem) {
    if (!window.confirm(`Hapus peran "${role.name}"?`)) return;
    try {
      await apiSend(`/api/dashboard/roles/${role.id}`, "DELETE");
      showToast("Peran dihapus.");
      refresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Gagal menghapus peran.");
    }
  }

  return (
    <SettingsShell
      section="peran"
      title="Peran & Izin"
      description="Buat peran kustom beserta paket izinnya. Peran bawaan (Akses Penuh, Admin Chat) bisa diubah izinnya tapi tidak bisa dihapus."
      headerExtra={
        <button
          type="button"
          onClick={() => setEditing("new")}
          className="inline-flex h-9 items-center gap-2 rounded-md bg-green-600 px-3.5 text-xs font-semibold text-white transition hover:bg-green-700"
        >
          <Plus size={14} />
          <span>Peran Baru</span>
        </button>
      }
    >
      {/* Stat strip */}
      <div className="mt-6 grid grid-cols-2 border-y border-slate-200 sm:grid-cols-4 sm:divide-x sm:divide-slate-200">
        <StatTile label="Total Peran" value={kpis.total} />
        <StatTile label="Total Penugasan" value={kpis.assignments} />
        <StatTile label="Peran Bawaan" value={kpis.system} tone="green" />
        <StatTile label="Rata-rata Izin" value={kpis.avgPerms} />
      </div>

      {/* Filter + search chrome */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div className="flex gap-1.5">
          {(
            [
              ["ALL", "Semua"],
              ["SYSTEM", "Bawaan"],
              ["CUSTOM", "Kustom"],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-medium transition",
                filter === k
                  ? "border-green-600 bg-green-50 text-green-700"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              )}
            >
              {l}
              <span className="ml-1.5 font-mono text-[10px] text-slate-400">
                {k === "ALL" ? roles.length : k === "SYSTEM" ? kpis.system : roles.length - kpis.system}
              </span>
            </button>
          ))}
        </div>
        <div className="relative">
          <MagnifyingGlass size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            type="text"
            placeholder="Cari peran..."
            className="h-8 w-56 rounded-md border border-slate-200 bg-slate-50 pl-7 pr-2.5 text-xs text-slate-800 placeholder-slate-400 focus:border-slate-300 focus:bg-white focus:outline-none"
          />
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {loading && <p className="mt-4 text-sm text-slate-500">Memuat peran...</p>}

      {/* Role cards */}
      {!loading && (
        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {filtered.map((r) => (
            <RoleCard
              key={r.id}
              role={r}
              onEdit={() => setEditing(r.id)}
              onDuplicate={() => void duplicate(r)}
              onRemove={() => void remove(r)}
            />
          ))}
          {filtered.length === 0 && (
            <p className="col-span-full py-12 text-center text-sm text-slate-400">
              Tidak ada peran yang cocok.
            </p>
          )}
        </div>
      )}

      {toast && <ToastBar msg={toast} />}
    </SettingsShell>
  );
}

function StatTile({ label, value, tone }: { label: string; value: number; tone?: "green" }) {
  return (
    <div className="py-3.5 pr-4 sm:px-5">
      <p className="text-[11px] font-medium text-slate-400">{label}</p>
      <p className={cn("mt-1 font-mono text-lg font-semibold", tone === "green" ? "text-green-700" : "text-slate-900")}>
        {value}
      </p>
    </div>
  );
}

// Per-group granted/total summary chips for a role card.
function GroupSummary({ permissions }: { permissions: string[] }) {
  const set = new Set(permissions);
  const summaries = FEATURE_GROUPS.map((group) => {
    const feats = PERMISSION_FEATURES.filter((f) => f.group === group);
    const total = feats.reduce((n, f) => n + f.keys.length, 0);
    const granted = feats.reduce((n, f) => n + f.keys.filter((k) => set.has(k)).length, 0);
    return { group, granted, total };
  }).filter((s) => s.granted > 0);
  if (summaries.length === 0) {
    return <p className="text-[11px] italic text-slate-400">Tidak ada izin.</p>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {summaries.map((s) => (
        <span
          key={s.group}
          className={cn(
            "rounded-full border px-2 py-0.5 font-mono text-[10px]",
            s.granted === s.total
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-slate-200 bg-slate-50 text-slate-500"
          )}
        >
          {s.group} {s.granted}/{s.total}
        </span>
      ))}
    </div>
  );
}

function RoleCard({
  role,
  onEdit,
  onDuplicate,
  onRemove,
}: {
  role: RoleItem;
  onEdit: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-slate-200 bg-white p-5 transition hover:border-slate-300">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-green-600 text-sm font-bold text-white">
            {role.name.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-slate-900">{role.name}</h3>
              {role.isSystem && (
                <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                  BAWAAN
                </span>
              )}
            </div>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {role.description ?? "Tanpa deskripsi."}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 text-slate-500">
          <Users size={13} />
          <span className="font-mono text-xs font-semibold">{role.userCount}</span>
        </div>
      </div>

      <div className="mt-4 flex-1">
        <GroupSummary permissions={role.permissions} />
      </div>

      <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3.5">
        <p className="text-[11px] text-slate-400">
          {role.permissions.length} izin - dibuat {fmtDate(role.createdAt)}
        </p>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onDuplicate}
            title="Duplikat"
            className="rounded-md border border-slate-200 bg-white p-1.5 text-slate-500 transition hover:bg-slate-50 hover:text-slate-800"
          >
            <Copy size={13} />
          </button>
          {!role.isSystem && (
            <button
              type="button"
              onClick={onRemove}
              disabled={role.userCount > 0}
              title={role.userCount > 0 ? "Pindahkan anggota dulu" : "Hapus peran"}
              className="rounded-md border border-red-200 bg-white p-1.5 text-red-500 transition hover:bg-red-50 disabled:opacity-40"
            >
              <Trash size={13} />
            </button>
          )}
          <button
            type="button"
            onClick={onEdit}
            className="ml-1 rounded-md bg-green-600 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-green-700"
          >
            Buka Editor
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Full-page role editor ───

function RoleEditor({
  role,
  onDone,
  onCancel,
}: {
  role: RoleItem | null;
  onDone: (msg?: string) => void;
  onCancel: () => void;
}) {
  const creating = role === null;
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [perms, setPerms] = useState<Set<PermissionKey>>(new Set(role?.permissions ?? []));
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const dirty =
    name !== (role?.name ?? "") ||
    description !== (role?.description ?? "") ||
    perms.size !== (role?.permissions.length ?? 0) ||
    (role?.permissions ?? []).some((k) => !perms.has(k));

  function toggleKey(key: PermissionKey) {
    setPerms((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function setLevel(feature: PermissionFeature, level: "off" | "baca" | "edit" | "penuh") {
    setPerms((prev) => {
      const next = new Set(prev);
      applyFeatureLevel(next, feature, level);
      return next;
    });
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
        onDone("Peran dibuat.");
      } else if (role) {
        await apiSend<RoleItem>(`/api/dashboard/roles/${role.id}`, "PUT", {
          name,
          description: description || null,
          permissions: [...perms],
        });
        onDone("Peran disimpan.");
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal menyimpan peran.");
    } finally {
      setBusy(false);
    }
  }

  async function removeSelf() {
    if (!role || !window.confirm(`Hapus peran "${role.name}"?`)) return;
    setBusy(true);
    try {
      await apiSend(`/api/dashboard/roles/${role.id}`, "DELETE");
      onDone("Peran dihapus.");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal menghapus peran.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="mt-2">
      {/* Breadcrumb + header */}
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center gap-1 hover:text-slate-900"
            >
              <ArrowLeft size={12} />Peran &amp; Izin
            </button>
            <span className="text-slate-300">/</span>
            <span className="font-medium text-slate-700">
              {creating ? "Peran Baru" : `Edit - ${role?.name}`}
            </span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={60}
              required
              disabled={!!role?.isSystem}
              placeholder="Nama peran"
              className={cn(
                "text-xl font-semibold tracking-tight text-slate-900 outline-none",
                "border-b border-transparent bg-transparent focus:border-green-600",
                role?.isSystem && "cursor-not-allowed"
              )}
              style={{ width: "100%", maxWidth: 420 }}
            />
            {role?.isSystem && (
              <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-700">
                BAWAAN
              </span>
            )}
          </div>
          {role?.isSystem && (
            <p className="mt-1 text-[11px] text-slate-400">Peran bawaan tidak dapat diubah namanya.</p>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 font-mono text-xs text-slate-400">
            {!creating && <span>ID: {role.id.slice(0, 8)}</span>}
            {!creating && <span>Dibuat: {fmtDate(role.createdAt)}</span>}
            <span>{perms.size} izin aktif</span>
            {!creating && <span>{role.userCount} anggota memakai peran ini</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="rounded-md bg-green-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-60"
          >
            {busy ? "Menyimpan..." : creating ? "Buat Peran" : "Simpan Perubahan"}
          </button>
        </div>
      </div>

      {/* Description */}
      <div className="grid grid-cols-1 gap-3.5 border-b border-slate-200 py-5 md:grid-cols-12">
        <div className="md:col-span-4">
          <label htmlFor="role-desc" className="text-sm font-semibold text-slate-900">
            Deskripsi Peran
          </label>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            Tujuan peran ini untuk siapa, mis. &quot;Kasir cabang: kelola pesanan, baca produk.&quot;
          </p>
        </div>
        <div className="md:col-span-8">
          <input
            id="role-desc"
            maxLength={200}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Untuk siapa peran ini?"
            className="h-9 w-full max-w-xl rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600/15"
          />
        </div>
      </div>

      {/* Permission sections: per-feature Baca/Edit/Penuh rows */}
      {FEATURE_GROUPS.map((group) => {
        const features = PERMISSION_FEATURES.filter((f) => f.group === group);
        const groupTotal = features.reduce((n, f) => n + f.keys.length, 0);
        const groupGranted = features.reduce(
          (n, f) => n + f.keys.filter((k) => perms.has(k)).length,
          0
        );
        return (
          <div key={group} className="border-b border-slate-200 py-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">{group}</h2>
              <span className="font-mono text-[11px] text-slate-400">
                {groupGranted}/{groupTotal} izin
              </span>
            </div>
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
              {features.map((f) => (
                <FeatureRow
                  key={f.key}
                  feature={f}
                  perms={perms}
                  onLevel={(level) => setLevel(f, level)}
                  onToggleKey={toggleKey}
                />
              ))}
            </div>
          </div>
        );
      })}

      {formError && <p className="mt-4 text-sm font-medium text-red-600">{formError}</p>}

      {/* Footer bar */}
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          {!creating && !role?.isSystem && (
            <button
              type="button"
              onClick={() => void removeSelf()}
              disabled={busy || (role?.userCount ?? 0) > 0}
              title={(role?.userCount ?? 0) > 0 ? "Pindahkan anggota dulu" : undefined}
              className="inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40"
            >
              <Trash size={13} /> Hapus Peran
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className={cn("text-xs", dirty ? "font-medium text-amber-600" : "text-slate-400")}>
            {dirty ? "Ada perubahan belum disimpan" : "Tersimpan"}
          </span>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={busy || !name.trim()}
            className="rounded-md bg-green-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-60"
          >
            {busy ? "Menyimpan..." : creating ? "Buat Peran" : "Simpan Perubahan"}
          </button>
        </div>
      </div>
    </form>
  );
}

function FeatureRow({
  feature,
  perms,
  onLevel,
  onToggleKey,
}: {
  feature: PermissionFeature;
  perms: Set<PermissionKey>;
  onLevel: (level: "off" | "baca" | "edit" | "penuh") => void;
  onToggleKey: (key: PermissionKey) => void;
}) {
  const level: FeatureLevel = featureLevel(feature, perms);
  const single = feature.baca.length === 0 && feature.edit.length === 0;
  // penuh == edit when the feature has exactly the edit keys (2-key
  // features): hide the redundant Penuh segment.
  const penuhRedundant = feature.edit.length === feature.keys.length;
  const segments: { key: "off" | "baca" | "edit" | "penuh"; label: string }[] = [
    { key: "off", label: "Tanpa Akses" },
    ...(feature.baca.length > 0 ? [{ key: "baca" as const, label: "Baca saja" }] : []),
    ...(feature.edit.length > 0 ? [{ key: "edit" as const, label: "Edit" }] : []),
    ...(!penuhRedundant && feature.edit.length > 0 ? [{ key: "penuh" as const, label: "Penuh" }] : []),
  ];
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <span className="text-sm font-medium text-slate-900">{feature.label}</span>
        {single ? (
          <button
            type="button"
            onClick={() => onLevel(perms.has(feature.keys[0]) ? "off" : "penuh")}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[11px] font-medium transition",
              perms.has(feature.keys[0])
                ? "border-green-600 bg-green-600 text-white"
                : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
            )}
          >
            {perms.has(feature.keys[0]) && <CheckCircle size={11} weight="fill" />}
            {perms.has(feature.keys[0]) ? "Aktif" : "Nonaktif"}
          </button>
        ) : (
          <div className="flex items-center gap-1.5">
            {level === "kustom" && (
              <span className="rounded-full border border-dashed border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                KUSTOM
              </span>
            )}
            <div className="flex overflow-hidden rounded-md border border-slate-200">
              {segments.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => onLevel(s.key)}
                  className={cn(
                    "px-2.5 py-1 text-[11px] font-medium transition",
                    level === s.key
                      ? "bg-green-600 text-white"
                      : "bg-white text-slate-500 hover:bg-slate-50"
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {/* The individual keys, always visible and clickable */}
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {feature.keys.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => onToggleKey(k)}
            title={k}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-medium transition",
              perms.has(k)
                ? "border-green-200 bg-green-50 text-green-700"
                : "border-slate-200 bg-slate-50 text-slate-400 hover:border-slate-300"
            )}
          >
            {KEY_LABELS[k] ?? k}
          </button>
        ))}
      </div>
    </div>
  );
}

function ToastBar({ msg }: { msg: string }) {
  return (
    <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-md bg-slate-900 px-3.5 py-2.5 text-xs font-medium text-white shadow-lg">
      <CheckCircle size={14} weight="fill" className="text-green-400" />
      {msg}
    </div>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth(
  async () => ({ props: {} }),
  { requiredPermission: "peran.kelola" }
);
