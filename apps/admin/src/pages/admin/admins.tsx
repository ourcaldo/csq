import { useState } from "react";
import type { FormEvent } from "react";
import { useSession } from "next-auth/react";
import { UserPlus } from "@phosphor-icons/react";
import { AdminShell } from "@/components/admin-shell";
import { btnPrimary } from "@/components/console";
import { confirmAction } from "@/components/confirm-dialog";
import { showToast } from "@/components/toast";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";

// Platform operators (template viewAdmins 1:1): inline add bar, remove via
// the shared destructive confirm dialog.

type Admin = { id: string; email: string; name: string; createdAt: string };

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

export default function AdminsPage() {
  const { data: session } = useSession();
  const { data, loading, error, refresh } = useAdminApi<{ items: Admin[] }>("/api/admin/admins");
  const [showAdd, setShowAdd] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const items = data?.items ?? [];
  const myId = session?.user?.id;

  async function addAdmin(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = e.currentTarget;
    setBusy("create");
    setFormError(null);
    try {
      await adminFetch("/api/admin/admins", "POST", {
        email: (f.elements.namedItem("na-email") as HTMLInputElement).value,
        name: (f.elements.namedItem("na-name") as HTMLInputElement).value,
        password: (f.elements.namedItem("na-pass") as HTMLInputElement).value,
      });
      setShowAdd(false);
      showToast("Platform operator added");
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to add the operator.");
    } finally {
      setBusy(null);
    }
  }

  function askRemove(a: Admin) {
    confirmAction({
      title: "Remove Platform Operator",
      desc: (
        <>
          Revoke Control Plane access for <strong>{a.name}</strong> (
          <code className="font-mono text-xs">{a.email}</code>)?
        </>
      ),
      btnLabel: "Remove Operator",
      onConfirm: () => {
        setBusy(a.id);
        void adminFetch(`/api/admin/admins?id=${a.id}`, "DELETE")
          .then(() => {
            showToast(`Operator ${a.name} removed`);
            refresh();
          })
          .catch((err: unknown) => setFormError(err instanceof Error ? err.message : "Failed to remove."))
          .finally(() => setBusy(null));
      },
    });
  }

  return (
    <AdminShell title="Admins">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Platform Operators</h1>
          <p className="mt-1 text-xs text-slate-500">
            Manage root-level administrators authorized to access the CSQ Control Plane.
          </p>
        </div>
        <button type="button" onClick={() => setShowAdd(!showAdd)} className={btnPrimary()}>
          <UserPlus size={14} />
          Add Operator
        </button>
      </div>

      {(formError || error) && (
        <div className="mt-5 rounded-md border border-slate-200 border-l-2 border-l-red-500 bg-card px-4 py-2.5 text-xs text-red-600">
          {formError ?? error}
        </div>
      )}

      {showAdd && (
        <form onSubmit={addAdmin} className="mt-5 border-y border-slate-200 bg-muted/70 px-4 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-12 sm:items-end">
            <div className="sm:col-span-3">
              <label htmlFor="na-name" className="block text-xs font-medium text-slate-700">
                Operator Name
              </label>
              <input
                id="na-name"
                name="na-name"
                type="text"
                required
                placeholder="Full name"
                className="mt-1 h-8 w-full rounded-md border border-slate-300 bg-card px-2.5 text-xs"
              />
            </div>
            <div className="sm:col-span-3">
              <label htmlFor="na-email" className="block text-xs font-medium text-slate-700">
                Email Address
              </label>
              <input
                id="na-email"
                name="na-email"
                type="email"
                required
                placeholder="name@csq.id"
                className="mt-1 h-8 w-full rounded-md border border-slate-300 bg-card px-2.5 text-xs"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="na-pass" className="block text-xs font-medium text-slate-700">
                Password
              </label>
              <input
                id="na-pass"
                name="na-pass"
                type="password"
                required
                minLength={8}
                placeholder="Min. 8 chars"
                className="mt-1 h-8 w-full rounded-md border border-slate-300 bg-card px-2.5 font-mono text-xs"
              />
            </div>
            <div className="flex items-center gap-2 sm:col-span-4">
              <button
                type="submit"
                disabled={busy === "create"}
                className="h-8 rounded-md bg-emerald-600 px-3.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-40"
              >
                Create
              </button>
              <button
                type="button"
                onClick={() => setShowAdd(false)}
                className="h-8 rounded-md border border-slate-300 bg-card px-3 text-xs text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </form>
      )}

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-y border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              <th className="py-3 pr-4">Operator</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Provisioned</th>
              <th className="py-3 pl-4 text-right">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 border-b border-slate-200">
            {loading && (
              <tr>
                <td colSpan={4} className="py-10 text-center text-xs text-slate-400">
                  Loading...
                </td>
              </tr>
            )}
            {items.map((a) => (
              <tr key={a.id} className="hover:bg-slate-50/80">
                <td className="py-3.5 pr-4 text-xs font-semibold text-slate-900">
                  {a.name}
                  {a.id === myId && (
                    <span className="ml-2 rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-emerald-700">
                      You
                    </span>
                  )}
                </td>
                <td className="px-4 py-3.5 font-mono text-xs text-slate-500">{a.email}</td>
                <td className="px-4 py-3.5 font-mono text-xs text-slate-500">
                  {new Date(a.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                </td>
                <td className="py-3.5 pl-4 text-right">
                  {a.id !== myId ? (
                    <button
                      type="button"
                      disabled={busy === a.id}
                      onClick={() => askRemove(a)}
                      className="text-xs font-medium text-red-600 hover:underline disabled:opacity-40"
                    >
                      Remove
                    </button>
                  ) : (
                    <span className="font-mono text-[11px] text-slate-400">Active Session</span>
                  )}
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 && !error && (
              <tr>
                <td colSpan={4} className="py-10 text-center text-xs text-slate-400">
                  No operators.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
