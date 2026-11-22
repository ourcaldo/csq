import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/router";
import { Key } from "@phosphor-icons/react";
import { AdminShell } from "@/components/admin-shell";
import { StatusLabel, bytes, btnOutline } from "@/components/console";
import { confirmAction } from "@/components/confirm-dialog";
import { showToast } from "@/components/toast";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";

// Tenant workspace inspector (template viewTenantDetail 1:1): telemetry
// strip, users table with inline password reset bar, three-column agents/
// channels/sources panel, destructive delete via the shared confirm dialog.

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
  users: { id: string; name: string | null; email: string; role: string }[];
  agents: { id: string; name: string; status: string }[];
  channels: { id: string; provider: string; type: string; status: string }[];
  campaigns: { id: string; name: string; status: string }[];
  dataSources: { id: string; name: string; type: string; status: string }[];
};

export const getServerSideProps = withAdminAuth<{ id: string }>(async (ctx) => ({
  props: { id: String(ctx.params?.id ?? "") },
}));

export default function TenantDetailPage({ id }: { id: string }) {
  const router = useRouter();
  const { data, loading, error, refresh } = useAdminApi<Detail>(`/api/admin/tenants/${id}`);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [resetUser, setResetUser] = useState<{ id: string; email: string } | null>(null);
  const [resetting, setResetting] = useState(false);

  async function toggleStatus() {
    if (!data) return;
    try {
      await adminFetch(`/api/admin/tenants/${id}`, "POST", {
        action: data.status === "ACTIVE" ? "suspend" : "activate",
      });
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to change the status.");
    }
  }

  async function submitReset(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!resetUser) return;
    const pw = (e.currentTarget.elements.namedItem("inline-new-pw") as HTMLInputElement).value;
    setResetting(true);
    setActionError(null);
    try {
      const r = await adminFetch<{ reset: true; email: string; emailed: boolean }>(
        `/api/admin/tenants/${id}`,
        "POST",
        { action: "reset_password", userId: resetUser.id, newPassword: pw }
      );
      setResetUser(null);
      setNotice(
        r.emailed
          ? `Password updated for ${r.email}. Notification sent via Platform SMTP.`
          : `Password updated for ${r.email}. No active SMTP - hand over the password manually.`
      );
      showToast("User password reset");
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Failed to reset the password.");
    } finally {
      setResetting(false);
    }
  }

  function askDelete() {
    if (!data) return;
    const name = data.name;
    const slug = data.slug;
    confirmAction({
      title: "Delete Workspace Permanently",
      desc: (
        <>
          This will permanently delete <strong>{name}</strong> (<code className="font-mono text-xs">{slug}</code>) and
          all associated customer records.
        </>
      ),
      requireText: name,
      btnLabel: "Delete Permanently",
      onConfirm: () => {
        void adminFetch(`/api/admin/tenants/${id}`, "POST", { action: "delete" })
          .then(() => {
            showToast(`Workspace "${name}" deleted`);
            router.push("/admin/tenants");
          })
          .catch((err: unknown) =>
            setActionError(err instanceof Error ? err.message : "Failed to delete the workspace.")
          );
      },
    });
  }

  if (error) {
    return (
      <AdminShell title="Tenant Detail">
        <div className="rounded-md border border-slate-200 border-l-2 border-l-red-500 bg-card px-4 py-3 text-xs text-red-600">
          {error}
        </div>
      </AdminShell>
    );
  }

  const d = data;

  return (
    <AdminShell title={d?.name ?? "Tenant Detail"}>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <button
              type="button"
              onClick={() => router.push("/admin/tenants")}
              className="inline-flex items-center gap-1 hover:text-slate-900"
            >
              Tenants
            </button>
            <span className="text-slate-300">/</span>
            <span className="font-mono text-slate-700">{d?.slug ?? ""}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-3">
            <h1 className="text-xl font-semibold tracking-tight text-slate-900">{d?.name ?? (loading ? "Loading..." : "Tenant")}</h1>
            {d && (
              <StatusLabel tone={d.status === "ACTIVE" ? "ok" : "bad"}>
                {d.status === "ACTIVE" ? "Active" : "Suspended"}
              </StatusLabel>
            )}
          </div>
          {d && (
            <p className="mt-1 font-mono text-xs text-slate-500">
              Created{" "}
              {new Date(d.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {d && (
            <button type="button" onClick={() => void toggleStatus()} className={btnOutline("h-8")}>
              {d.status === "ACTIVE" ? "Suspend Workspace" : "Activate Workspace"}
            </button>
          )}
          <button type="button" onClick={() => router.push("/admin/tenants")} className={btnOutline("h-8")}>
            Back
          </button>
        </div>
      </div>

      {notice && (
        <div className="mt-5 flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-muted/80 px-4 py-2.5 text-xs text-slate-800">
          <div className="flex items-center gap-2">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
            <span>{notice}</span>
          </div>
        </div>
      )}
      {actionError && (
        <div className="mt-5 rounded-md border border-slate-200 border-l-2 border-l-red-500 bg-card px-4 py-2.5 text-xs text-red-600">
          {actionError}
        </div>
      )}

      {d && (
        <>
          {/* Telemetry strip */}
          <div className="mt-6 grid grid-cols-2 border-y border-slate-200 sm:grid-cols-5 sm:divide-x sm:divide-slate-200">
            <div className="py-3.5 pr-4">
              <p className="text-[11px] font-medium text-slate-400">Team Members</p>
              <p className="mt-1 font-mono text-lg font-semibold text-slate-900">{d.userCount}</p>
            </div>
            <div className="py-3.5 sm:px-5">
              <p className="text-[11px] font-medium text-slate-400">Connected Channels</p>
              <p className="mt-1 font-mono text-lg font-semibold text-slate-900">{d.channelCount}</p>
            </div>
            <div className="border-t border-slate-200 py-3.5 pr-4 sm:border-t-0 sm:px-5">
              <p className="text-[11px] font-medium text-slate-400">Conversations</p>
              <p className="mt-1 font-mono text-lg font-semibold text-slate-900">{d.conversationCount}</p>
            </div>
            <div className="border-t border-slate-200 py-3.5 sm:border-t-0 sm:px-5">
              <p className="text-[11px] font-medium text-slate-400">Messages (30d)</p>
              <p className="mt-1 font-mono text-lg font-semibold text-slate-900">
                {d.messageCount30d.toLocaleString("en-GB")}
              </p>
            </div>
            <div className="border-t border-slate-200 py-3.5 sm:border-t-0 sm:pl-5">
              <p className="text-[11px] font-medium text-slate-400">Media Footprint</p>
              <p className="mt-1 font-mono text-lg font-semibold text-slate-900">{bytes(d.mediaBytes)}</p>
            </div>
          </div>

          {/* Users + inline password reset */}
          <div className="border-b border-slate-200 py-6">
            <h2 className="pb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Workspace Users ({d.users.length})
            </h2>

            {resetUser && (
              <form onSubmit={submitReset} className="mb-4 flex flex-wrap items-center gap-2.5 rounded-md border border-slate-200 bg-muted/80 px-4 py-2.5">
                <span className="text-xs text-slate-700">
                  Set new password for <strong className="font-mono text-slate-900">{resetUser.email}</strong>:
                </span>
                <input
                  name="inline-new-pw"
                  type="text"
                  required
                  minLength={8}
                  placeholder="Min. 8 chars"
                  className="h-8 w-48 rounded-md border border-slate-300 bg-card px-2.5 font-mono text-xs text-slate-900 focus:border-emerald-600 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={resetting}
                  className="rounded-md bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
                >
                  {resetting ? "Applying..." : "Apply Password"}
                </button>
                <button
                  type="button"
                  onClick={() => setResetUser(null)}
                  className="rounded-md border border-slate-300 bg-card px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </form>
            )}

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-y border-slate-200 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    <th className="py-2.5 pr-4">Name</th>
                    <th className="px-4 py-2.5">Email</th>
                    <th className="px-4 py-2.5">Role</th>
                    <th className="py-2.5 pl-4 text-right">Credentials</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 border-b border-slate-200">
                  {d.users.map((u) => (
                    <tr key={u.id} className="hover:bg-slate-50/80">
                      <td className="py-3 pr-4 font-semibold text-slate-900">{u.name ?? "-"}</td>
                      <td className="px-4 py-3 font-mono text-slate-500">{u.email}</td>
                      <td className="px-4 py-3">
                        <StatusLabel tone={u.role === "OWNER" ? "ok" : "off"}>{u.role}</StatusLabel>
                      </td>
                      <td className="py-3 pl-4 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            setResetUser({ id: u.id, email: u.email });
                            setActionError(null);
                            setNotice(null);
                          }}
                          className="font-medium text-emerald-700 hover:underline"
                        >
                          <Key size={11} className="mr-1 inline" />
                          Reset Password
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Agents / Channels / Data sources grid */}
          <div className="grid grid-cols-1 divide-y divide-slate-200 border-b border-slate-200 lg:grid-cols-3 lg:divide-x lg:divide-y-0">
            <div className="py-5 lg:pr-6">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">AI Agents ({d.agents.length})</h3>
              <div className="mt-3 divide-y divide-slate-100">
                {d.agents.map((a) => (
                  <div key={a.id} className="flex items-center justify-between py-2 text-xs">
                    <span className="font-medium text-slate-800">{a.name}</span>
                    <StatusLabel tone={a.status === "ACTIVE" ? "ok" : "warn"}>{a.status}</StatusLabel>
                  </div>
                ))}
                {d.agents.length === 0 && <p className="py-3 text-xs text-slate-400">No agents configured.</p>}
              </div>
            </div>
            <div className="py-5 lg:px-6">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Channels ({d.channels.length})</h3>
              <div className="mt-3 divide-y divide-slate-100">
                {d.channels.map((c) => (
                  <div key={c.id} className="flex items-center justify-between py-2 text-xs">
                    <span className="font-mono text-slate-800">{c.provider}</span>
                    <StatusLabel tone={c.status === "CONNECTED" ? "ok" : "bad"}>
                      {c.status === "CONNECTED" ? "Connected" : "Disconnected"}
                    </StatusLabel>
                  </div>
                ))}
                {d.channels.length === 0 && <p className="py-3 text-xs text-slate-400">No channels attached.</p>}
              </div>
            </div>
            <div className="py-5 lg:pl-6">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">Data Sources ({d.dataSources.length})</h3>
              <div className="mt-3 divide-y divide-slate-100">
                {d.dataSources.map((s) => (
                  <div key={s.id} className="flex items-center justify-between py-2 text-xs">
                    <span className="font-medium text-slate-800">
                      {s.name} <span className="font-mono text-[10px] text-slate-400">({s.type})</span>
                    </span>
                    <StatusLabel tone={s.status === "ACTIVE" ? "ok" : "bad"}>{s.status}</StatusLabel>
                  </div>
                ))}
                {d.dataSources.length === 0 && <p className="py-3 text-xs text-slate-400">No data sources synced.</p>}
              </div>
            </div>
          </div>

          {/* Danger zone */}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-md border border-red-200 bg-red-50/30 px-4 py-3.5">
            <div>
              <p className="text-xs font-semibold text-red-800">Permanent Workspace Deletion</p>
              <p className="mt-0.5 text-xs text-slate-600">
                Deletes all users, conversations, messages, orders, media, and disconnects WhatsApp sessions
                irreversibly.
              </p>
            </div>
            <button
              type="button"
              onClick={askDelete}
              className="rounded-md bg-red-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-red-700"
            >
              Delete Workspace
            </button>
          </div>
        </>
      )}
    </AdminShell>
  );
}
