import { type FormEvent, useState } from "react";
import { useSession } from "next-auth/react";
import { Plus, X } from "@phosphor-icons/react";
import { AdminShell } from "@/components/admin-shell";
import { Btn, PageHead, TableCard } from "@/components/console";
import { Dialog } from "@csq/ui/components/ui/dialog";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";
import { Input } from "@csq/ui/components/ui/input";
import { Label } from "@csq/ui/components/ui/label";

// Operators (PRD 13 Phase 4). Console copy is English (owner direction
// 2026-11-13).

type Admin = { id: string; email: string; name: string; createdAt: string };
type AdminList = { items: Admin[] };

const EMPTY_FORM = { email: "", name: "", password: "" };

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

export default function AdminsPage() {
  const { data: session } = useSession();
  const { data, loading, error, refresh } = useAdminApi<AdminList>("/api/admin/admins");
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const items = data?.items ?? [];
  const myId = session?.user?.id;

  async function createAdmin(e: FormEvent) {
    e.preventDefault();
    setBusy("create");
    setFormError(null);
    try {
      await adminFetch("/api/admin/admins", "POST", form);
      setShowCreate(false);
      setForm(EMPTY_FORM);
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to add the admin.");
    } finally {
      setBusy(null);
    }
  }

  async function removeAdmin(id: string) {
    setBusy(id);
    setFormError(null);
    try {
      await adminFetch(`/api/admin/admins?id=${id}`, "DELETE");
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to remove the admin.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <AdminShell title="Admins">
      <PageHead
        eyebrow="Configuration"
        title="Admins"
        sub={`${items.length} platform operators`}
        action={
          <Btn onClick={() => setShowCreate(true)}>
            <Plus size={14} weight="bold" />
            New admin
          </Btn>
        }
      />

      {(formError || error) && (
        <div className="mb-4 rounded-xl border border-border border-l-2 border-l-bad bg-card px-5 py-3 text-[13px] text-bad">
          {formError ?? error}
        </div>
      )}

      <TableCard>
        <table className="ledger">
          <thead>
            <tr>
              <th>Operator</th>
              <th>Email</th>
              <th>Since</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((a) => (
              <tr key={a.id}>
                <td className="font-medium">
                  {a.name}
                  {a.id === myId && (
                    <span className="ml-2 rounded-full bg-signal-soft px-2 py-0.5 text-[11px] font-semibold text-primary">
                      You
                    </span>
                  )}
                </td>
                <td className="text-[13px]">{a.email}</td>
                <td className="font-mono text-[12.5px] text-muted-foreground">
                  {new Date(a.createdAt).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </td>
                <td className="text-right">
                  {a.id !== myId && (
                    <Btn
                      variant="ghost"
                      disabled={busy === a.id}
                      onClick={() => void removeAdmin(a.id)}
                      className="hover:text-bad"
                    >
                      Remove
                    </Btn>
                  )}
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={4} className="py-12 text-center text-[13px] text-muted-foreground">
                  No admins.
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={4} className="py-12 text-center text-[13px] text-muted-foreground">
                  Loading...
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableCard>

      <Dialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        ariaLabel="New admin"
        className="max-w-sm rounded-2xl border-border bg-card p-0 shadow-[0_24px_64px_rgba(0,0,0,0.18)]"
      >
            <div className="flex items-start justify-between border-b border-border px-5 py-4">
              <div>
                <div className="eyebrow mb-1">Configuration</div>
                <h2 className="text-[18px] font-semibold tracking-tight">New admin</h2>
              </div>
              <button
                onClick={() => setShowCreate(false)}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>
            <form onSubmit={createAdmin} className="space-y-4 p-5">
              <div className="space-y-1.5">
                <Label htmlFor="a-email">Email</Label>
                <Input
                  id="a-email"
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="operator@csq.id"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="a-name">Name</Label>
                <Input
                  id="a-name"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Operator name"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="a-pass">Password</Label>
                <Input
                  id="a-pass"
                  type="password"
                  required
                  minLength={8}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="Minimum 8 characters"
                />
              </div>
              {formError && <p className="text-[13px] text-bad">{formError}</p>}
              <div className="flex justify-end gap-2 pt-1">
                <Btn type="button" variant="line" onClick={() => setShowCreate(false)}>
                  Cancel
                </Btn>
                <Btn type="submit" disabled={busy === "create"}>
                  {busy === "create" ? "Adding..." : "Add admin"}
                </Btn>
              </div>
            </form>
      </Dialog>
    </AdminShell>
  );
}
