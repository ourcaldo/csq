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
// Console copy is English (owner direction 2026-11-13).

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
  return new Date(iso).toLocaleString("en-GB", {
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
          ? `Password for ${r.email} was reset. The new credentials were emailed.`
          : `Password for ${r.email} was reset, but the email was NOT sent (no active SMTP). Hand over the new password manually.`
      );
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to reset the password.");
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
          `[tenant-delete] only ${r.channelsDisconnected}/${r.channelsTotal} channels were disconnected before the delete`
        );
      }
      router.push("/admin/tenants");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to delete the tenant.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AdminShell title="Tenant detail">
      <PageHead
        eyebrow="Platform"
        title={data?.name ?? "Tenant"}
        sub={data?.slug ?? "Tenant detail"}
        action={
          <Link href="/admin/tenants" className={btnClass("ghost")}>
            <ArrowLeft size={14} />
            All tenants
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
        <p className="text-[13px] text-muted-foreground">Loading tenant detail...</p>
      )}

      {data && (
        <div className="space-y-8">
          <Section
            title="Summary"
            meta={
              <Status tone={data.status === "ACTIVE" ? "ok" : "bad"}>
                {data.status === "ACTIVE" ? "Active" : "Suspended"}
              </Status>
            }
          >
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-6">
              <Stat
                label="Created"
                value={new Date(data.createdAt).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              />
              <Stat label="Users" value={data.userCount} />
              <Stat label="Channels" value={data.channelCount} />
              <Stat label="Conversations" value={data.conversationCount} />
              <Stat label="Msgs (30d)" value={data.messageCount30d} />
              <Stat label="Media" value={bytes(data.mediaBytes)} />
            </div>
          </Section>

          <Section title="Users" meta={`${data.users.length} accounts`}>
            {data.users.length === 0 ? (
              <Empty title="No users yet" hint="This tenant has no accounts yet." />
            ) : (
              <TableCard>
                <table className="ledger">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
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
                            {u.role === "OWNER" ? "Owner" : "Staff"}
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

          <Section title="Agents" meta={`${data.agents.length} agents`}>
            {data.agents.length === 0 ? (
              <Empty title="No agents yet" hint="The tenant's agents will appear here." />
            ) : (
              <TableCard>
                <table className="ledger">
                  <thead>
                    <tr>
                      <th>Name</th>
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

          <Section title="Channels" meta={`${data.channels.length} channels`}>
            {data.channels.length === 0 ? (
              <Empty title="No channels yet" hint="The tenant's channels will appear here." />
            ) : (
              <TableCard>
                <table className="ledger">
                  <thead>
                    <tr>
                      <th>Provider</th>
                      <th>Type</th>
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
                            {c.status === "CONNECTED" ? "Connected" : "Disconnected"}
                          </Status>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableCard>
            )}
          </Section>

          <Section title="Campaigns" meta={`${data.campaigns.length} campaigns`}>
            {data.campaigns.length === 0 ? (
              <Empty title="No campaigns yet" hint="The tenant's campaigns will appear here." />
            ) : (
              <TableCard>
                <table className="ledger">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Status</th>
                      <th>Schedule</th>
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

          <Section title="Data sources" meta={`${data.dataSources.length} sources`}>
            {data.dataSources.length === 0 ? (
              <Empty title="No data sources yet" hint="The tenant's data sources will appear here." />
            ) : (
              <TableCard>
                <table className="ledger">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th>Last sync</th>
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
          <Section title="Danger zone" meta="Irreversible">
            <div className="flex items-center gap-4 rounded-xl border border-bad/30 bg-bad/5 px-5 py-4">
              <Warning size={20} weight="fill" className="shrink-0 text-bad" />
              <div className="flex-1">
                <p className="text-[13px] font-medium">Delete tenant "{data.name}"</p>
                <p className="text-[13px] text-muted-foreground">
                  All tenant data is deleted permanently: users, conversations, messages, orders,
                  campaigns, media, and channels (disconnected first). This cannot be undone.
                </p>
              </div>
              <Btn onClick={() => { setDeleteOpen(true); setDeleteConfirmName(""); }}>
                Delete tenant
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
        description={resetUser ? `New password for ${resetUser.email}` : undefined}
      >
        <form onSubmit={submitReset} className="space-y-3">
          <div>
            <Label htmlFor="new-password">New password (min. 8 characters)</Label>
            <Input
              id="new-password"
              type="text"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="new password"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Credentials are emailed to the user when SMTP is active; otherwise hand them over
            manually.
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setResetUser(null)}
              className={btnClass("line")}
            >
              Cancel
            </button>
            <button type="submit" disabled={resetting || newPassword.length < 8} className={btnClass()}>
              {resetting ? "Resetting..." : "Reset Password"}
            </button>
          </div>
        </form>
      </Dialog>

      {/* Delete confirmation dialog - the tenant name must be typed */}
      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete tenant"
        description={`Type the tenant name "${data?.name ?? ""}" to confirm. This action is permanent.`}
      >
        <form onSubmit={submitDelete} className="space-y-3">
          <div>
            <Label htmlFor="delete-confirm">Tenant name</Label>
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
              Cancel
            </button>
            <button
              type="submit"
              disabled={deleting || deleteConfirmName !== data?.name}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-bad px-4 text-[13px] font-medium text-white transition-colors disabled:pointer-events-none disabled:opacity-50"
            >
              {deleting ? "Deleting..." : "Delete permanently"}
            </button>
          </div>
        </form>
      </Dialog>
    </AdminShell>
  );
}
