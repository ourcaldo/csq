// /dashboard/pengaturan/peran - PRD 29 role management: list of the
// tenant's roles + full-width inline editor (no modal) with the
// Baca/Edit/Penuh preset radio that PRE-FILLS the permission matrix
// (the matrix stays the editable source of truth).
import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { GetServerSideProps } from "next";
import { CheckCircle, Copy, Plus, Trash, X } from "@phosphor-icons/react";
import { withAuth } from "@csq/core/lib/auth";
import {
  PERMISSION_GROUPS,
  ROLE_PRESETS,
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

type PresetKey = "baca" | "edit" | "penuh" | "kustom";

const PRESET_LABELS: Record<Exclude<PresetKey, "kustom">, string> = {
  baca: "Baca saja",
  edit: "Edit",
  penuh: "Penuh",
};

function presetFor(perms: Set<PermissionKey>): PresetKey {
  for (const key of ["baca", "edit", "penuh"] as const) {
    const set = new Set(ROLE_PRESETS[key]);
    if (set.size === perms.size && [...perms].every((p) => set.has(p))) return key;
  }
  return "kustom";
}

export default function PengaturanPeranPage() {
  const { data, loading, error, refresh } = useApi<{ items: RoleItem[] }>(
    "/api/dashboard/roles"
  );
  const roles = useMemo(() => data?.items ?? [], [data]);

  const [editing, setEditing] = useState<RoleItem | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [perms, setPerms] = useState<Set<PermissionKey>>(new Set());
  const [preset, setPreset] = useState<PresetKey>("kustom");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2800);
  }

  function openEditor(role: RoleItem) {
    setCreating(false);
    setEditing(role);
    setName(role.name);
    setDescription(role.description ?? "");
    const set = new Set<PermissionKey>(role.permissions);
    setPerms(set);
    setPreset(presetFor(set));
    setFormError(null);
  }

  function openCreate() {
    setCreating(true);
    setEditing(null);
    setName("");
    setDescription("");
    setPerms(new Set());
    setPreset("kustom");
    setFormError(null);
  }

  function closeEditor() {
    setEditing(null);
    setCreating(false);
    setFormError(null);
  }

  function applyPreset(key: Exclude<PresetKey, "kustom">) {
    const set = new Set<PermissionKey>(ROLE_PRESETS[key]);
    setPerms(set);
    setPreset(key);
  }

  function togglePerm(key: PermissionKey, checked: boolean) {
    setPerms((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      setPreset(presetFor(next));
      return next;
    });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setFormError(null);
    try {
      if (creating) {
        await apiSend<RoleItem>("/api/dashboard/roles", "POST", {
          name,
          description: description || undefined,
          permissions: [...perms],
        });
        showToast("Peran dibuat.");
      } else if (editing) {
        await apiSend<RoleItem>(`/api/dashboard/roles/${editing.id}`, "PUT", {
          name,
          description: description || null,
          permissions: [...perms],
        });
        showToast("Peran disimpan.");
      }
      closeEditor();
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal menyimpan peran.");
    } finally {
      setBusy(false);
    }
  }

  async function duplicate(role: RoleItem) {
    if (busy) return;
    setBusy(true);
    setFormError(null);
    try {
      let n = 2;
      let candidate = `${role.name} (${n})`;
      const names = new Set(roles.map((r) => r.name));
      while (names.has(candidate)) {
        n += 1;
        candidate = `${role.name} (${n})`;
      }
      await apiSend<RoleItem>("/api/dashboard/roles", "POST", {
        name: candidate,
        description: role.description ?? undefined,
        permissions: role.permissions,
      });
      showToast("Peran diduplikat.");
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal menduplikasi peran.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(role: RoleItem) {
    if (busy || !window.confirm(`Hapus peran "${role.name}"?`)) return;
    setBusy(true);
    setFormError(null);
    try {
      await apiSend(`/api/dashboard/roles/${role.id}`, "DELETE");
      showToast("Peran dihapus.");
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal menghapus peran.");
    } finally {
      setBusy(false);
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
          onClick={openCreate}
          className="inline-flex h-9 items-center gap-2 rounded-md bg-green-600 px-3.5 text-xs font-semibold text-white transition hover:bg-green-700"
        >
          <Plus size={14} />
          <span>Peran Baru</span>
        </button>
      }
    >
      {/* Editor / create form (full-width inline, no modal) */}
      {(editing || creating) && (
        <form onSubmit={save} className="mt-6 space-y-5 border-y border-slate-200 bg-slate-50/70 px-4 py-5 sm:px-5">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-900">
              {creating ? "Peran Baru" : `Edit: ${editing?.name}`}
            </h2>
            <button
              type="button"
              onClick={closeEditor}
              className="rounded p-1 text-slate-400 hover:bg-slate-200/70 hover:text-slate-700"
              aria-label="Tutup editor"
            >
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
            <div>
              <label htmlFor="role-name" className="block text-xs font-medium text-slate-700">
                Nama Peran
              </label>
              <input
                id="role-name"
                required
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!!editing?.isSystem}
                className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-900 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600/15 disabled:bg-slate-100"
              />
              {editing?.isSystem && (
                <p className="mt-1 text-[11px] text-slate-400">Peran bawaan tidak dapat diubah namanya.</p>
              )}
            </div>
            <div>
              <label htmlFor="role-desc" className="block text-xs font-medium text-slate-700">
                Deskripsi
              </label>
              <input
                id="role-desc"
                maxLength={200}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Untuk siapa peran ini?"
                className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-900 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600/15"
              />
            </div>
          </div>

          {/* Preset radio: PRE-FILLS the matrix below */}
          <div>
            <p className="text-xs font-medium text-slate-700">Preset Awal</p>
            <p className="mt-0.5 text-[11px] text-slate-400">
              Radio ini hanya mengisi matriks di bawah - centangannya tetap bisa diubah satu per satu.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(["baca", "edit", "penuh"] as const).map((k) => (
                <label
                  key={k}
                  className={cn(
                    "flex h-9 cursor-pointer items-center gap-2 rounded-md border px-3.5 text-xs font-medium transition",
                    preset === k
                      ? "border-green-600 bg-green-50 text-green-700"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                  )}
                >
                  <input
                    type="radio"
                    name="preset"
                    checked={preset === k}
                    onChange={() => applyPreset(k)}
                    className="h-3.5 w-3.5 text-green-600 focus:ring-green-600"
                  />
                  {PRESET_LABELS[k]}
                </label>
              ))}
              {preset === "kustom" && (
                <span className="flex h-9 items-center rounded-md border border-dashed border-slate-300 px-3.5 text-xs text-slate-400">
                  Kustom
                </span>
              )}
            </div>
          </div>

          {/* Permission matrix */}
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3">
            {PERMISSION_GROUPS.map((group) => (
              <div key={group.label} className="rounded-lg border border-slate-200 bg-white p-3.5">
                <p className="text-xs font-semibold text-slate-900">{group.label}</p>
                <div className="mt-2 space-y-1.5">
                  {group.keys.map((k) => (
                    <label key={k.key} className="flex items-center gap-2 text-xs text-slate-700">
                      <input
                        type="checkbox"
                        checked={perms.has(k.key)}
                        onChange={(e) => togglePerm(k.key, e.target.checked)}
                        className="h-3.5 w-3.5 rounded border-slate-300 text-green-600 focus:ring-green-600"
                      />
                      {k.label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {formError && <p className="text-xs font-medium text-red-600">{formError}</p>}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={closeEditor}
              className="rounded-md border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={busy || !name.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
            >
              {busy ? "Menyimpan..." : "Simpan Peran"}
            </button>
          </div>
        </form>
      )}

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {loading && <p className="mt-4 text-sm text-slate-500">Memuat peran...</p>}

      {/* Role list */}
      {!loading && (
        <div className="mt-6 space-y-3">
          {roles.map((r) => (
            <div
              key={r.id}
              className="flex flex-col justify-between gap-3 rounded-xl border border-slate-200 bg-white p-5 lg:flex-row lg:items-center"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-slate-900">{r.name}</h3>
                  {r.isSystem && (
                    <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700">
                      Bawaan
                    </span>
                  )}
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                    {r.userCount} anggota
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                    {r.permissions.length} izin
                  </span>
                </div>
                {r.description && (
                  <p className="mt-1 text-xs text-slate-500">{r.description}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={() => openEditor(r)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50"
                >
                  Edit Izin
                </button>
                <button
                  type="button"
                  onClick={() => void duplicate(r)}
                  disabled={busy}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  <Copy size={13} /> Duplikat
                </button>
                {!r.isSystem && (
                  <button
                    type="button"
                    onClick={() => void remove(r)}
                    disabled={busy || r.userCount > 0}
                    title={r.userCount > 0 ? "Pindahkan anggota dulu" : undefined}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-600 transition hover:bg-red-50 disabled:opacity-50"
                  >
                    <Trash size={13} /> Hapus
                  </button>
                )}
              </div>
            </div>
          ))}
          {roles.length === 0 && (
            <p className="py-10 text-center text-sm text-slate-400">Belum ada peran.</p>
          )}
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-md bg-slate-900 px-3.5 py-2.5 text-xs font-medium text-white shadow-lg">
          <CheckCircle size={14} weight="fill" className="text-green-400" />
          {toast}
        </div>
      )}
    </SettingsShell>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth(
  async () => ({ props: {} }),
  { requiredPermission: "peran.kelola" }
);
