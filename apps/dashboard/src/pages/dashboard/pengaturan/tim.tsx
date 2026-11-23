// /dashboard/pengaturan/tim - Tim & Hak Akses (reference: docs/demo/
// manajemen_tim_csq_enterprise.html). Inline invite composer (no modal),
// telemetry strip, tabs: Anggota Aktif / Riwayat Undangan / Matriks Peran.
// All wired to the existing team APIs.
import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { GetServerSideProps } from "next";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { CheckCircle, Funnel, UserPlus, X } from "@phosphor-icons/react";
import { withAuth } from "@csq/core/lib/auth";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { SettingsShell } from "@/components/dashboard/settings/settings-shell";
import { cn } from "@csq/ui/lib/utils";

type TeamMember = {
  id: string;
  email: string;
  name: string | null;
  isOwner: boolean;
  roleId: string | null;
  roleName: string | null;
  createdAt: string;
};

type RoleOption = {
  id: string;
  name: string;
  isSystem: boolean;
};

type InviteResult = {
  inviteId: string;
  email: string;
  roleId: string;
  emailed: boolean;
  inviteLink?: string;
  note?: string;
};

type InviteView = {
  id: string;
  email: string;
  roleId: string | null;
  roleName: string | null;
  status: "PENDING" | "EXPIRED" | "ACCEPTED";
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
};

const PAGE_SIZE = 50;

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function initials(name: string | null, email: string): string {
  const base = (name ?? email).trim();
  const parts = base.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export default function PengaturanTimPage() {
  const { data: session } = useSession();
  const isOwner = !!session?.user?.isOwner;

  const { data, loading, error, refresh } = useApi<{ items: TeamMember[] }>(
    `/api/dashboard/team?page=1&pageSize=${PAGE_SIZE}`
  );
  const invitesApi = useApi<{ items: InviteView[] }>("/api/dashboard/team/invites");
  const invites = invitesApi.data?.items ?? [];
  const members = useMemo(() => data?.items ?? [], [data]);
  const rolesApi = useApi<{ items: RoleOption[] }>("/api/dashboard/roles");
  const roles = useMemo(() => rolesApi.data?.items ?? [], [rolesApi.data]);

  const [tab, setTab] = useState<"members" | "invites" | "roles">("members");
  const [search, setSearch] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRoleId, setInviteRoleId] = useState<string>("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2800);
  }

  const filteredMembers = members.filter((m) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (m.name ?? "").toLowerCase().includes(q) || m.email.toLowerCase().includes(q)
    );
  });

  const kpis = {
    total: members.length,
    owners: members.filter((m) => m.isOwner).length,
    roles: roles.length,
    pending: invites.filter((i) => i.status === "PENDING").length,
  };

  async function submitInvitation(e: FormEvent) {
    e.preventDefault();
    if (inviting || !inviteEmail.trim() || !inviteRoleId) return;
    setInviting(true);
    setInviteError(null);
    try {
      const result = await apiSend<InviteResult>("/api/dashboard/team/invite", "POST", {
        name: inviteEmail.split("@")[0],
        email: inviteEmail,
        roleId: inviteRoleId,
      });
      setInviteOpen(false);
      setInviteEmail("");
      setInviteRoleId("");
      setInviteResult(result);
      refresh();
      invitesApi.refresh();
    } catch (err) {
      setInviteError(err instanceof Error ? err.message : "Gagal mengirim undangan.");
    } finally {
      setInviting(false);
    }
  }

  async function changeMemberRole(m: TeamMember, roleId: string) {
    setActionError(null);
    setBusyId(m.id);
    try {
      await apiSend(`/api/dashboard/team/${m.id}`, "PUT", { roleId });
      refresh();
      showToast("Peran anggota diperbarui.");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal mengubah peran.");
    } finally {
      setBusyId(null);
    }
  }

  async function resendInvite(id: string) {
    if (busyId) return;
    setBusyId(id);
    setActionError(null);
    try {
      await apiSend(`/api/dashboard/team/invites?id=${id}`, "POST");
      showToast("Undangan terkirim ulang.");
      invitesApi.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal mengirim ulang undangan.");
    } finally {
      setBusyId(null);
    }
  }

  async function cancelInvite(id: string) {
    if (busyId) return;
    setBusyId(id);
    setActionError(null);
    try {
      await apiSend(`/api/dashboard/team/invites?id=${id}`, "DELETE");
      showToast("Undangan dibatalkan.");
      invitesApi.refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal membatalkan undangan.");
    } finally {
      setBusyId(null);
    }
  }

  async function removeMember(m: TeamMember) {
    if (busyId || !window.confirm(`Hapus ${m.name ?? m.email} dari tim?`)) return;
    setBusyId(m.id);
    setActionError(null);
    try {
      await apiSend(`/api/dashboard/team/${m.id}`, "DELETE");
      refresh();
      showToast("Anggota dihapus.");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal menghapus anggota.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <SettingsShell
      section="tim"
      title="Tim & Hak Akses"
      description="Kelola anggota organisasi, peran operasional, serta izin eksekusi kampanye pada dashboard."
      headerExtra={
        <button
          type="button"
          onClick={() => setInviteOpen((v) => !v)}
          className="inline-flex h-9 items-center gap-2 rounded-md bg-green-600 px-3.5 text-xs font-semibold text-white transition hover:bg-green-700"
        >
          <UserPlus size={14} />
          <span>Undang Staff</span>
        </button>
      }
    >
      {/* Inline invitation composer (no modal) */}
      {inviteOpen && (
        <div className="mt-6 border-y border-slate-200 bg-slate-50/70 px-4 py-5 sm:px-5">
          <form onSubmit={submitInvitation} className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-900">
                  Kirim Undangan Anggota Baru
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  Tautan undangan berlaku 7 hari dan dikirim ke email penerima.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setInviteOpen(false)}
                className="rounded p-1 text-slate-400 hover:bg-slate-200/70 hover:text-slate-700"
                aria-label="Tutup panel undangan"
              >
                <X size={16} />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3.5 md:grid-cols-12 md:items-end">
              <div className="md:col-span-5">
                <label htmlFor="invite-email" className="block text-xs font-medium text-slate-700">
                  Alamat Email Kerja
                </label>
                <input
                  id="invite-email"
                  type="email"
                  required
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="nama@perusahaan.com"
                  className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-xs text-slate-900 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600/15"
                />
              </div>
              <div className="md:col-span-3">
                <label htmlFor="invite-role" className="block text-xs font-medium text-slate-700">
                  Peran
                </label>
                <select
                  id="invite-role"
                  required
                  value={inviteRoleId}
                  onChange={(e) => setInviteRoleId(e.target.value)}
                  className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-white px-2.5 text-xs text-slate-900 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600/15"
                >
                  <option value="" disabled>
                    Pilih peran...
                  </option>
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-4">
                <p className="text-[11px] leading-relaxed text-slate-500">
                  Tautan undangan berlaku 7 hari, sekali pakai, dan dikirim ke email penerima.
                  Ubah isi peran kapan saja di menu Peran &amp; Izin.
                </p>
              </div>
            </div>
            {inviteError && <p className="text-xs font-medium text-red-600">{inviteError}</p>}
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setInviteOpen(false)}
                className="rounded-md border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={inviting}
                className="inline-flex items-center gap-1.5 rounded-md bg-green-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
              >
                {inviting ? "Mengirim..." : "Kirim Undangan"}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* One-time link result */}
      {inviteResult && (
        <div className="mt-5 border-l-2 border-amber-500 bg-amber-50/70 py-3 pl-4 pr-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-medium text-amber-900">
              {inviteResult.emailed
                ? `Undangan ke ${inviteResult.email} terkirim.`
                : `Email belum terkirim - bagikan tautan ini secara manual ke ${inviteResult.email}:`}
            </p>
            <button type="button" onClick={() => setInviteResult(null)} className="text-amber-700 hover:text-amber-950">
              <X size={14} />
            </button>
          </div>
          {!inviteResult.emailed && inviteResult.inviteLink && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="flex-1 select-all overflow-x-auto whitespace-nowrap rounded border border-amber-200 bg-white px-2.5 py-1.5 font-mono text-xs text-slate-900">
                {inviteResult.inviteLink}
              </code>
              <button
                type="button"
                onClick={() => void navigator.clipboard.writeText(inviteResult.inviteLink ?? "")}
                className="rounded border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-50"
              >
                Salin
              </button>
            </div>
          )}
        </div>
      )}

      {/* Telemetry strip */}
      <div className="mt-6 grid grid-cols-2 border-y border-slate-200 sm:grid-cols-4 sm:divide-x sm:divide-slate-200">
        <div className="py-3.5 pr-4">
          <p className="text-[11px] font-medium text-slate-400">Total Anggota Aktif</p>
          <p className="mt-1 font-mono text-lg font-semibold text-slate-900">{kpis.total}</p>
        </div>
        <div className="py-3.5 sm:px-5">
          <p className="text-[11px] font-medium text-slate-400">Owner / Admin</p>
          <p className="mt-1 font-mono text-lg font-semibold text-slate-900">{kpis.owners}</p>
        </div>
        <div className="border-t border-slate-200 py-3.5 pr-4 sm:border-t-0 sm:px-5">
          <p className="text-[11px] font-medium text-slate-400">Peran Tersedia</p>
          <p className="mt-1 font-mono text-lg font-semibold text-green-700">{kpis.roles}</p>
        </div>
        <div className="border-t border-slate-200 py-3.5 sm:border-t-0 sm:pl-5">
          <p className="text-[11px] font-medium text-slate-400">Undangan Tertunda</p>
          <p className="mt-1 font-mono text-lg font-semibold text-slate-900">{kpis.pending}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-6 flex items-center justify-between border-b border-slate-200">
        <div className="flex gap-6">
          {(
            [
              ["members", `Anggota Aktif`],
              ["invites", `Riwayat Undangan`],
              ["roles", `Matriks Peran & Izin`],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className={cn(
                "relative pb-2.5 text-xs transition-colors",
                tab === k ? "font-semibold text-slate-900" : "text-slate-500 hover:text-slate-900"
              )}
            >
              {l}
              {k === "members" && (
                <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                  {members.length}
                </span>
              )}
              {k === "invites" && (
                <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                  {invites.length}
                </span>
              )}
              {tab === k && (
                <span className="absolute inset-x-0 bottom-[-1px] h-0.5 bg-green-600" />
              )}
            </button>
          ))}
        </div>
        <div className="relative hidden pb-1.5 sm:block">
          <Funnel size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            type="text"
            placeholder="Filter nama atau email..."
            className="h-7 w-52 rounded border border-slate-200 bg-slate-50 pl-7 pr-2.5 text-xs text-slate-800 placeholder-slate-400 focus:border-slate-300 focus:bg-white focus:outline-none"
          />
        </div>
      </div>

      {actionError && <p className="mt-4 text-sm text-red-600">{actionError}</p>}
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      {loading && <p className="mt-4 text-sm text-slate-500">Memuat tim...</p>}

      {/* TAB: members */}
      {!loading && tab === "members" && (
        <div className="overflow-x-auto pt-2">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <th className="py-3 pr-4">Anggota</th>
                <th className="px-4 py-3">Peran</th>
                <th className="hidden px-4 py-3 md:table-cell">Bergabung</th>
                <th className="px-4 py-3">Izin Kampanye</th>
                <th className="py-3 pl-4 text-right">Tindakan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 border-b border-slate-200">
              {filteredMembers.map((m) => (
                <tr key={m.id} className="hover:bg-slate-50/70">
                  <td className="py-3 pr-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                        {initials(m.name, m.email)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {m.name ?? m.email}
                          {m.id === session?.user?.id && (
                            <span className="ml-1.5 text-xs font-normal text-slate-400">(Anda)</span>
                          )}
                        </p>
                        <p className="truncate text-xs text-slate-500">{m.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {m.isOwner ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
                        Pemilik
                      </span>
                    ) : isOwner && m.id !== session?.user?.id ? (
                      <select
                        value={m.roleId ?? ""}
                        disabled={busyId === m.id}
                        onChange={(e) => void changeMemberRole(m, e.target.value)}
                        className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-900 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600/15"
                      >
                        <option value="" disabled>
                          Tanpa peran
                        </option>
                        {roles.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">
                        {m.roleName ?? "Tanpa peran"}
                      </span>
                    )}
                  </td>
                  <td className="hidden px-4 py-3 text-xs text-slate-500 md:table-cell">
                    {fmtDate(m.createdAt)}
                  </td>
                  <td className="py-3 pl-4 text-right">
                    {isOwner && m.id !== session?.user?.id && (
                      <button
                        type="button"
                        onClick={() => void removeMember(m)}
                        disabled={busyId === m.id}
                        className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                      >
                        {busyId === m.id ? "Menghapus..." : "Hapus"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB: invites */}
      {!loading && tab === "invites" && (
        <div className="overflow-x-auto pt-2">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <th className="py-3 pr-4">Email Penerima</th>
                <th className="px-4 py-3">Status</th>
                <th className="hidden px-4 py-3 sm:table-cell">Dikirim</th>
                <th className="hidden px-4 py-3 md:table-cell">Berlaku Sampai</th>
                <th className="py-3 pl-4 text-right">Tindakan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 border-b border-slate-200">
              {invites.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-sm text-slate-400">
                    Belum ada undangan.
                  </td>
                </tr>
              )}
              {invites.map((inv) => (
                <tr key={inv.id} className="hover:bg-slate-50/70">
                  <td className="py-3 pr-4 font-medium text-slate-900">{inv.email}</td>
                  <td className="px-4 py-3">
                    {inv.status === "PENDING" ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                        Menunggu
                      </span>
                    ) : inv.status === "EXPIRED" ? (
                      <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-500">
                        Kedaluwarsa
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-0.5 text-xs font-medium text-green-700">
                        <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                        Diterima
                      </span>
                    )}
                  </td>
                  <td className="hidden px-4 py-3 text-xs text-slate-500 sm:table-cell">
                    {fmtDate(inv.createdAt)}
                  </td>
                  <td className="hidden px-4 py-3 text-xs text-slate-500 md:table-cell">
                    {fmtDate(inv.expiresAt)}
                  </td>
                  <td className="py-3 pl-4 text-right">
                    {inv.status !== "ACCEPTED" && isOwner && (
                      <div className="flex justify-end gap-3">
                        <button
                          type="button"
                          onClick={() => void resendInvite(inv.id)}
                          disabled={busyId !== null}
                          className="text-xs font-medium text-slate-600 hover:underline disabled:opacity-50"
                        >
                          {busyId === inv.id ? "Mengirim..." : "Kirim Ulang"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void cancelInvite(inv.id)}
                          disabled={busyId !== null}
                          className="text-xs font-medium text-red-600 hover:underline disabled:opacity-50"
                        >
                          Batalkan
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* TAB: roles matrix -> pointer to the PRD 29 role editor */}
      {tab === "roles" && (
        <div className="pt-6">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-slate-900">Peran &amp; Izin Kustom</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Sejak pembaruan ini, izin diatur per peran kustom - bukan lagi
              matriks tetap Owner/Staff. Buat peran, atur izinnya per modul,
              lalu tugaskan ke anggota di tab Anggota Aktif.
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                  <th className="py-3 pr-4">Peran</th>
                  <th className="w-32 px-4 py-3">Anggota</th>
                  <th className="w-32 px-4 py-3">Jumlah Izin</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 border-b border-slate-200 text-slate-700">
                {roles.map((r) => (
                  <tr key={r.id}>
                    <td className="py-3 pr-4 font-medium text-slate-900">
                      <Link href="/dashboard/pengaturan/peran" className="hover:underline">
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 font-mono">
                      {members.filter((m) => m.roleId === r.id).length}
                    </td>
                    <td className="px-4 py-3 font-mono text-green-700">-</td>
                  </tr>
                ))}
                {roles.length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-10 text-center text-slate-400">
                      Belum ada peran.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <Link
            href="/dashboard/pengaturan/peran"
            className="mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-green-600 px-3.5 text-xs font-semibold text-white transition hover:bg-green-700"
          >
            Kelola Peran &amp; Izin
          </Link>
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
  { requiredPermission: "pengaturan.tim" }
);
