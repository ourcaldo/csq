import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { GetServerSideProps } from "next";
import { useSession } from "next-auth/react";
import { UserPlus, Users } from "@phosphor-icons/react";
import { withAuth } from "@csq/core/lib/auth";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import type { ListResult } from "@csq/core/types/dashboard";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { StateNotice } from "@/components/dashboard/state-notice";
import { EmptyState } from "@/components/dashboard/empty-state";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { ReadOnlyField } from "@/components/dashboard/channels/field";
import { Dialog } from "@csq/ui/components/ui/dialog";
import { Button } from "@csq/ui/components/ui/button";
import { Input } from "@csq/ui/components/ui/input";
import { Label } from "@csq/ui/components/ui/label";
import { Badge } from "@csq/ui/components/ui/badge";
import { Select } from "@csq/ui/components/ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@csq/ui/components/ui/table";

// Local client-side types - mirror the API route's serialized output. The API
// layer remains the source of truth; these exist so rendering is type-safe
// without importing Prisma-generated types (whose Date/enum shapes don't match
// JSON the browser receives).
type TeamRole = "OWNER" | "STAFF";

type TeamMember = {
  id: string;
  email: string;
  name: string | null;
  role: TeamRole;
  canRunCampaigns: boolean;
  createdAt: string;
};

type InviteResult = {
  inviteId: string;
  email: string;
  role: "STAFF";
  emailed: boolean;
  inviteLink?: string;
  note?: string;
};

const PAGE_SIZE = 50;

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("id-ID", {
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

export default function TeamPage() {
  const { data: session } = useSession();
  const isOwner = session?.user?.role === "OWNER";

  const url = `/api/dashboard/team?page=1&pageSize=${PAGE_SIZE}`;
  const { data, loading, error, refresh } = useApi<ListResult<TeamMember>>(url);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // The invite API emails the one-time link when a provider is configured;
  // otherwise it returns the link once for the owner to relay out-of-band.
  const [created, setCreated] = useState<InviteResult | null>(null);

  // Row-level mutation errors (role change / delete / campaign toggle) render
  // above the table; formError belongs to the invite dialog only.
  const [actionError, setActionError] = useState<string | null>(null);

  const [toDelete, setToDelete] = useState<TeamMember | null>(null);
  const [deleting, setDeleting] = useState(false);

  const currentUserId = session?.user?.id;

  const members = useMemo(() => data?.items ?? [], [data]);

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const result = await apiSend<InviteResult>("/api/dashboard/team/invite", "POST", {
        name,
        email,
      });
      setInviteOpen(false);
      setName("");
      setEmail("");
      setCreated(result);
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal mengirim undangan.");
    } finally {
      setSaving(false);
    }
  }

  function closeCreated() {
    setCreated(null);
  }

  // Per-staff campaign permission (feature plan 2026-11-01, decision 2.2).
  async function onToggleCampaignPermission(member: TeamMember, checked: boolean) {
    setActionError(null);
    try {
      await apiSend(`/api/dashboard/team/${member.id}`, "PUT", { canRunCampaigns: checked });
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal mengubah izin kampanye.");
    }
  }

  // Role change (PRD 16 FEA-5); the server enforces the last-owner guard.
  async function onRoleChange(member: TeamMember, value: string) {
    if (value !== "OWNER" && value !== "STAFF") return;
    setActionError(null);
    try {
      await apiSend(`/api/dashboard/team/${member.id}`, "PUT", { role: value });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal mengubah peran.");
    }
    refresh();
  }

  async function onConfirmDelete() {
    if (!toDelete) return;
    setDeleting(true);
    setActionError(null);
    try {
      await apiSend(`/api/dashboard/team/${toDelete.id}`, "DELETE");
      setToDelete(null);
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal menghapus anggota.");
      setToDelete(null);
    } finally {
      setDeleting(false);
    }
  }

  return (
    <DashboardShell
      title="Tim"
      description="Anggota organisasi yang dapat mengakses dashboard."
      actions={
        isOwner ? (
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus size={16} weight="bold" className="mr-1.5" />
            Undang Staff
          </Button>
        ) : undefined
      }
    >
      {!isOwner && (
        <p className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700">
          Hanya owner yang dapat mengundang anggota tim baru.
        </p>
      )}

      {loading && <StateNotice variant="loading" message="Memuat anggota tim…" />}
      {error && <StateNotice variant="error" message={error} />}
      {actionError && <StateNotice variant="error" message={actionError} />}

      {!loading && !error && members.length === 0 && (
        <EmptyState
          icon={<Users size={20} weight="bold" />}
          title="Belum ada anggota tim"
          description="Undang staff untuk membantu mengelola percakapan dan data dashboard."
          action={
            isOwner ? (
              <Button onClick={() => setInviteOpen(true)}>
                <UserPlus size={16} weight="bold" className="mr-1.5" />
                Undang Staff
              </Button>
            ) : undefined
          }
        />
      )}

      {!loading && !error && members.length > 0 && (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Anggota</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Peran</TableHead>
                <TableHead className="hidden sm:table-cell">Bergabung</TableHead>
                {isOwner && <TableHead className="hidden md:table-cell">Izin Kampanye</TableHead>}
                {isOwner && <TableHead className="text-right">Tindakan</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((m) => {
                const isYou = m.id === currentUserId;
                return (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600">
                          {initials(m.name, m.email)}
                        </div>
                        <div className="flex flex-col">
                          <span className="font-medium text-slate-900">
                            {m.name ?? m.email}
                            {isYou && (
                              <span className="ml-2 text-xs font-normal text-slate-400">
                                (Anda)
                              </span>
                            )}
                          </span>
                          {m.name && (
                            <span className="text-xs text-slate-500">{m.email}</span>
                          )}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.name ? m.email : "-"}
                    </TableCell>
                    <TableCell>
                      {isOwner ? (
                        <Select
                          value={m.role}
                          onChange={(e) => onRoleChange(m, e.target.value)}
                          aria-label="Peran"
                          className="h-9 w-28"
                        >
                          <option value="OWNER">Owner</option>
                          <option value="STAFF">Staff</option>
                        </Select>
                      ) : m.role === "OWNER" ? (
                        <Badge variant="success">Owner</Badge>
                      ) : (
                        <Badge variant="secondary">Staff</Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {formatDate(m.createdAt)}
                    </TableCell>
                    {isOwner && (
                      <TableCell className="hidden md:table-cell">
                        {m.role === "OWNER" ? (
                          <span className="text-xs text-muted-foreground">Selalu (owner)</span>
                        ) : (
                          <label className="flex items-center gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={m.canRunCampaigns}
                              onChange={(e) => onToggleCampaignPermission(m, e.target.checked)}
                              className="h-4 w-4"
                            />
                            Boleh jalankan kampanye
                          </label>
                        )}
                      </TableCell>
                    )}
                    {isOwner && (
                      <TableCell className="text-right">
                        <Button variant="destructive" size="sm" onClick={() => setToDelete(m)}>
                          Hapus
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Invite dialog */}
      <Dialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Undang Staff"
        description="Staff akan menerima tautan untuk membuat password mereka sendiri."
      >
        <form onSubmit={onInvite} className="flex flex-col gap-4">
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-name">Nama</Label>
            <Input
              id="invite-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nama lengkap staff"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input
              id="invite-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="staff@toko.com"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Mengirim…" : "Kirim Undangan"}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Invite result - when the tenant has no email provider the link is
          shown once (ReadOnlyField copy pattern) for the owner to relay. */}
      <Dialog
        open={created !== null}
        onClose={closeCreated}
        title="Undangan dibuat"
        description={
          created?.emailed
            ? `Undangan dikirim ke ${created?.email ?? ""}.`
            : (created?.note ?? "")
        }
      >
        {created && (
          <div className="flex flex-col gap-4">
            {!created.emailed && created.inviteLink && (
              <ReadOnlyField
                label="Tautan undangan"
                value={created.inviteLink}
                hint="Berlaku 7 hari dan hanya dapat dipakai sekali."
              />
            )}
            <div className="flex justify-end">
              <Button onClick={closeCreated}>Tutup</Button>
            </div>
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={toDelete !== null}
        title="Hapus Anggota"
        description={`Yakin ingin menghapus "${toDelete?.name ?? toDelete?.email}" dari tim? Akses dashboard mereka dicabut.`}
        confirmLabel="Hapus"
        destructive
        loading={deleting}
        onConfirm={onConfirmDelete}
        onCancel={() => setToDelete(null)}
      />
    </DashboardShell>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth<Record<string, unknown>>(
  async () => ({ props: {} }),
  { requiredRole: "OWNER" }
);
