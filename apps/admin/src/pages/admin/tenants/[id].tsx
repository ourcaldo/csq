import Link from "next/link";
import { type FormEvent, useState } from "react";
import { useRouter } from "next/router";
import { ArrowLeft, Warning, Key } from "@phosphor-icons/react";
import { AdminShell } from "@/components/admin-shell";
import { Btn, Empty, PageHead, Section, Stat, Status, TableCard, btnClass } from "@/components/console";
import { Dialog } from "@csq/ui/components/ui/dialog";
import { Input } from "@csq/ui/components/ui/input";
import { Label } from "@csq/ui/components/ui/label";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";

// ADM-1 (PRD 16): tenant drill-down + platform actions (owner request
// 2026-11-11): per-user password reset (credentials emailed when a provider
// exists) and tenant deletion (channels disconnected first, then the cascade
// removes every tenant row - unrecoverable, typed-name confirmation).

type Detail = {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
  userCount: number;
  channelCount: number;
  conversationCount: number;
  messageCount30d: number;
  mediaBytes: number;
  users: { id: string; email: string; name: string | null; role: string }[];
  channels: { id: string; provider: string; status: string; type: string }[];
  agents: { id: string; name: string; status: string }[];
  campaigns: { id: string; name: string; status: string; scheduleKind: string }[];
  dataSources: {
    id: string;
    name: string;
    type: string;
    status: string;
    lastSyncAt: string | null;
  }[];
};

export const getServerSideProps = withAdminAuth<{ id: string }>(async (ctx) => ({
  props: { id: String(ctx.params?.id ?? "") },
}));

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function when(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function agentTone(status: string): "ok" | "warn" | "off" {
  if (status === "ACTIVE") return "ok";
  if (status === "PAUSED") return "warn";
  return "off";
}

function campaignTone(status: string): "ok" | "warn" | "off" {
  if (status === "ACTIVE" || status === "COMPLETED") return "ok";
  if (status === "PAUSED") return "warn";
  return "off";
}

function sourceTone(status: string): "ok" | "bad" | "off" {
  if (status === "ACTIVE") return "ok";
  if (status === "ERROR") return "bad";
  return "off";
}

export default function TenantDetailPage({ id }: { id: string }) {
  const router = useRouter();
  const { data, loading, error, refresh } = useAdminApi<Detail>(`/api/admin/tenants/${id}`);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Reset password state.
  const [resetUser, setResetUser] = useState<{ id: string; email: string } | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetting, setResetting] = useState(false);

  // Delete state: the button only enables when the tenant name is typed.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function submitReset(e: FormEvent) {
    e.preventDefault();
    if (!resetUser || resetting || newPassword.length < 8) return;
    setResetting(true);
    setActionError(null);
    setNotice(null);
    try {
      const r = await adminFetch<{ reset: true; email: string; emailed: boolean }>(
        `/api/admin/tenants/${id}`,
        "POST",
        { action: "reset_password", userId: resetUser.id, newPassword }
      );
      setResetUser(null);
      setNewPassword("");
      setNotice(
        r.emailed
          ? `Password ${r.email} direset. Kredensial baru dikirim ke emailnya.`
          : `Password ${r.email} direset, tetapi email TIDAK terkirim (tidak ada SMTP aktif). Serahkan password baru secara manual.`
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal mereset password.");
    } finally {
      setResetting(false);
    }
  }

  async function submitDelete(e: FormEvent) {
    e.preventDefault();
    if (deleting || !data || deleteConfirmName !== data.name) return;
    setDeleting(true);
    setActionError(null);
    setNotice(null);
    try {
      const r = await adminFetch<{ deleted: true; channelsDisconnected: number; channelsTotal: number }>(
        `/api/admin/tenants/${id}`,
        "POST",
        { action: "delete" }
      );
      if (r.channelsTotal > 0 && r.channelsDisconnected < r.channelsTotal) {
        console.warn(
          `[tenant-delete] hanya ${r.channelsDisconnected}/${r.channelsTotal} saluran sempat diputus sebelum hapus`
        );
      }
      router.push("/admin/tenants");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal menghapus tenant.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AdminShell title="Detail tenant">
      <PageHead
        eyebrow="Platform"
        title={data?.name ?? "Tenant"}
        sub={data?.slug ?? "Detail tenant"}
        action={
          <Link href="/admin/tenants" className={btnClass("ghost")}>
            <ArrowLeft size={14} />
            Semua tenant
          </Link>
        }
      />

      {error && (
        <div className="mb-4 rounded-xl border border-border border-l-2 border-l-bad bg-card px-5 py-3 text-[13px] text-bad">
          {error}
        </div>
      )}
      {actionError && (
        <div className="mb-4 rounded-xl border border-border border-l-2 border-l-bad bg-card px-5 py-3 text-[13px] text-bad">
          {actionError}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-xl border border-border border-l-2 border-l-ok bg-card px-5 py-3 text-[13px]">
          {notice}
        </div>
      )}
      {loading && (
        <p className="text-[13px] text-muted-foreground">Memuat detail tenant...</p>
      )}

      {data && (
        <div className="space-y-8">
          <Section
            title="Ringkasan"
            meta={
              <Status tone={data.status === "ACTIVE" ? "ok" : "bad"}>
                {data.status === "ACTIVE" ? "Aktif" : "Ditangguhkan"}
              </Status>
            }
          >
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
              <Stat
                label="Dibuat"
                value={new Date(data.createdAt).toLocaleDateString("id-ID", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              />
              <Stat label="Pengguna" value={data.userCount} />
              <Stat label="Saluran" value={data.channelCount} />
              <Stat label="Percakapan" value={data.conversationCount} />
              <Stat label="Pesan 30 hari" value={data.messageCount30d} />
              <Stat label="Media" value={bytes(data.mediaBytes)} />
            </div>
          </Section>

          <Section title="Pengguna" meta={`${data.users.length} akun`}>
            {data.users.length === 0 ? (
              <Empty title="Belum ada pengguna" hint="Tenant belum memiliki akun." />
            ) : (
              <TableCard>
                <table className="ledger">
                  <thead>
                    <tr>
                      <th>Nama</th>
                      <th>Email</th>
                      <th>Peran</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {data.users.map((u) => (
                      <tr key={u.id}>
                        <td className="font-medium">{u.name ?? "-"}</td>
                        <td className="font-mono text-[12.5px] text-muted-foreground">
                          {u.email}
                        </td>
                        <td>
                          <Status tone={u.role === "OWNER" ? "ok" : "off"}>
                            {u.role === "OWNER" ? "Owner" : "Staf"}
                          </Status>
                        </td>
                        <td className="text-right">
                          <button
                            onClick={() => {
                              setResetUser({ id: u.id, email: u.email });
                              setNewPassword("");
                              setActionError(null);
                              setNotice(null);
                            }}
                            className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                          >
                            <Key size={12} />
                            Reset Password
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableCard>
            )}
          </Section>

          <Section title="Agent" meta={`${data.agents.length} agent`}>
            {data.agents.length === 0 ? (
              <Empty title="Belum ada agent" hint="Agent tenant akan muncul di sini." />
            ) : (
              <TableCard>
                <table className="ledger">
                  <thead>
                    <tr>
                      <th>Nama</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.agents.map((a) => (
                      <tr key={a.id}>
                        <td className="font-medium">{a.name}</td>
                        <td>
                          <Status tone={agentTone(a.status)}>{a.status}</Status>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableCard>
            )}
          </Section>

          <Section title="Saluran" meta={`${data.channels.length} saluran`}>
            {data.channels.length === 0 ? (
              <Empty title="Belum ada saluran" hint="Saluran tenant akan muncul di sini." />
            ) : (
              <TableCard>
                <table className="ledger">
                  <thead>
                    <tr>
                      <th>Provider</th>
                      <th>Tipe</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.channels.map((c) => (
                      <tr key={c.id}>
                        <td className="font-medium">{c.provider}</td>
                        <td className="text-[13px] text-muted-foreground">{c.type}</td>
                        <td>
                          <Status tone={c.status === "CONNECTED" ? "ok" : "bad"}>
                            {c.status === "CONNECTED" ? "Terhubung" : "Terputus"}
                          </Status>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableCard>
            )}
          </Section>

          <Section title="Kampanye" meta={`${data.campaigns.length} kampanye`}>
            {data.campaigns.length === 0 ? (
              <Empty title="Belum ada kampanye" hint="Kampanye tenant akan muncul di sini." />
            ) : (
              <TableCard>
                <table className="ledger">
                  <thead>
                    <tr>
                      <th>Nama</th>
                      <th>Status</th>
                      <th>Jadwal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.campaigns.map((c) => (
                      <tr key={c.id}>
                        <td className="font-medium">{c.name}</td>
                        <td>
                          <Status tone={campaignTone(c.status)}>{c.status}</Status>
                        </td>
                        <td className="font-mono text-[12px] text-muted-foreground">
                          {c.scheduleKind}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableCard>
            )}
          </Section>

          <Section title="Sumber Data" meta={`${data.dataSources.length} sumber`}>
            {data.dataSources.length === 0 ? (
              <Empty title="Belum ada sumber data" hint="Sumber data tenant akan muncul di sini." />
            ) : (
              <TableCard>
                <table className="ledger">
                  <thead>
                    <tr>
                      <th>Nama</th>
                      <th>Tipe</th>
                      <th>Status</th>
                      <th>Sinkron terakhir</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.dataSources.map((d) => (
                      <tr key={d.id}>
                        <td className="font-medium">{d.name}</td>
                        <td className="font-mono text-[12px] text-muted-foreground">{d.type}</td>
                        <td>
                          <Status tone={sourceTone(d.status)}>{d.status}</Status>
                        </td>
                        <td className="whitespace-nowrap font-mono text-[12px] text-muted-foreground">
                          {when(d.lastSyncAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableCard>
            )}
          </Section>

          {/* Danger zone - unrecoverable. */}
          <Section title="Zona Bahaya" meta="Tidak dapat dibatalkan">
            <div className="flex items-center gap-4 rounded-xl border border-bad/30 bg-bad/5 px-5 py-4">
              <Warning size={20} weight="fill" className="shrink-0 text-bad" />
              <div className="flex-1">
                <p className="text-[13px] font-medium">Hapus tenant "{data.name}"</p>
                <p className="text-[13px] text-muted-foreground">
                  Semua data tenant dihapus permanen: pengguna, percakapan, pesan, pesanan,
                  kampanye, media, dan saluran (diputus lebih dulu). Tidak bisa dikembalikan.
                </p>
              </div>
              <Btn onClick={() => { setDeleteOpen(true); setDeleteConfirmName(""); }}>
                Hapus Tenant
              </Btn>
            </div>
          </Section>
        </div>
      )}

      {/* Reset password dialog */}
      <Dialog
        open={resetUser !== null}
        onClose={() => setResetUser(null)}
        title="Reset Password"
        description={resetUser ? `Password baru untuk ${resetUser.email}` : undefined}
      >
        <form onSubmit={submitReset} className="space-y-3">
          <div>
            <Label htmlFor="new-password">Password baru (min. 8 karakter)</Label>
            <Input
              id="new-password"
              type="text"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="password baru"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Kredensial dikirim ke email pengguna bila SMTP aktif; jika tidak, serahkan secara manual.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setResetUser(null)}
              className={btnClass("line")}
            >
              Batal
            </button>
            <button type="submit" disabled={resetting || newPassword.length < 8} className={btnClass()}>
              {resetting ? "Meriset..." : "Reset Password"}
            </button>
          </div>
        </form>
      </Dialog>

      {/* Delete confirmation dialog - the tenant name must be typed */}
      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Hapus Tenant"
        description={`Ketik nama tenant "${data?.name ?? ""}" untuk mengonfirmasi. Tindakan ini permanen.`}
      >
        <form onSubmit={submitDelete} className="space-y-3">
          <div>
            <Label htmlFor="delete-confirm">Nama tenant</Label>
            <Input
              id="delete-confirm"
              required
              value={deleteConfirmName}
              onChange={(e) => setDeleteConfirmName(e.target.value)}
              placeholder={data?.name ?? ""}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setDeleteOpen(false)}
              className={btnClass("line")}
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={deleting || deleteConfirmName !== data?.name}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-bad px-4 text-[13px] font-medium text-white transition-colors disabled:pointer-events-none disabled:opacity-50"
            >
              {deleting ? "Menghapus..." : "Hapus Permanen"}
            </button>
          </div>
        </form>
      </Dialog>
    </AdminShell>
  );
}
