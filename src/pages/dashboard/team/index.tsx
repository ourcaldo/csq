import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { GetServerSideProps } from "next";
import { useSession } from "next-auth/react";
import { UserPlus, Users, EnvelopeSimple } from "@phosphor-icons/react";
import { withAuth } from "@/lib/auth";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import type { ListResult } from "@/types/dashboard";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { StateNotice } from "@/components/dashboard/state-notice";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

// Local client-side types — mirror the API route's serialized output. The API
// layer remains the source of truth; these exist so rendering is type-safe
// without importing Prisma-generated types (whose Date/enum shapes don't match
// JSON the browser receives).
type TeamRole = "OWNER" | "STAFF";

type TeamMember = {
  id: string;
  email: string;
  name: string | null;
  role: TeamRole;
  createdAt: string;
};

type InviteResult = {
  userId: string;
  email: string;
  name: string;
  role: "STAFF";
  tempPassword: string;
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
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // The invite API returns the generated temp password once. We surface it in a
  // dismissible notice so the owner can relay it out-of-band (MVP has no email).
  const [created, setCreated] = useState<InviteResult | null>(null);

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
        password: password || undefined,
      });
      setInviteOpen(false);
      setName("");
      setEmail("");
      setPassword("");
      setCreated(result);
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal mengundang staff.");
    } finally {
      setSaving(false);
    }
  }

  function closeCreated() {
    setCreated(null);
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
                <TableHead className="hidden sm:table-cell">Dibergabung</TableHead>
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
                      {m.name ? m.email : "—"}
                    </TableCell>
                    <TableCell>
                      {m.role === "OWNER" ? (
                        <Badge variant="success">Owner</Badge>
                      ) : (
                        <Badge variant="secondary">Staff</Badge>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">
                      {formatDate(m.createdAt)}
                    </TableCell>
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
        description="Staff baru akan dibuatkan akun pada organisasi Anda."
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="invite-password">Password (opsional)</Label>
            <Input
              id="invite-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Kosongkan untuk dibuatkan otomatis"
            />
            <p className="text-xs text-muted-foreground">
              Jika dikosongkan, password sementara akan dibuatkan dan ditampilkan sekali setelah undangan.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>
              Batal
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Mengundang…" : "Undang"}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Temp-password reveal — shown once after a successful invite */}
      <Dialog
        open={created !== null}
        onClose={closeCreated}
        title="Staff berhasil diundang"
        description="Password sementara hanya ditampilkan sekali. Sampaikan kepada staff melalui jalur yang aman."
      >
        {created && (
          <div className="flex flex-col gap-4">
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700">
              <EnvelopeSimple size={16} weight="bold" className="mr-1.5 inline-block align-text-bottom" />
              MVP tidak mengirim email. Sampaikan kredensial berikut di luar aplikasi.
            </div>
            <div className="flex flex-col gap-2 rounded-md border bg-slate-50 p-4">
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-medium text-slate-500">Nama</span>
                <span className="text-sm text-slate-900">{created.name}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-medium text-slate-500">Email</span>
                <span className="text-sm text-slate-900">{created.email}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-medium text-slate-500">Peran</span>
                <span className="text-sm text-slate-900">Staff</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-xs font-medium text-slate-500">Password sementara</span>
                <code className="break-all rounded bg-white px-2 py-1 text-sm font-semibold text-green-700 border">
                  {created.tempPassword}
                </code>
              </div>
            </div>
            <div className="flex justify-end">
              <Button onClick={closeCreated}>Saya sudah menyimpan</Button>
            </div>
          </div>
        )}
      </Dialog>
    </DashboardShell>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth<Record<string, unknown>>(
  async () => ({ props: {} }),
  { requiredRole: "OWNER" }
);
