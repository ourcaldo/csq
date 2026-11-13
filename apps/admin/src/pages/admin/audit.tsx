import { Fragment, useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { Btn, Empty, PageHead, TableCard } from "@/components/console";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi } from "@/lib/admin-api";
import { Input } from "@csq/ui/components/ui/input";

// Audit (PRD 13 Phase 4). Console copy is English (owner direction
// 2026-11-13).

type AuditItem = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  customerPhone: string | null;
  createdAt: string;
  tenantName?: string;
  adminEmail?: string;
  adminName?: string;
  targetType?: string;
  targetId?: string | null;
  beforeValue?: unknown;
  afterValue?: unknown;
};
type AuditData = { items: AuditItem[]; total: number; page: number; pageSize: number };

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

function Action({ value }: { value: string }) {
  const [prefix, ...rest] = value.split(".");
  const suffix = rest.join(".");
  const tone = value.includes("error") ? "text-bad" : "text-foreground";
  return (
    <span className={`font-mono text-[12.5px] ${tone}`}>
      <span className="text-muted-foreground">{prefix}.</span>
      {suffix}
    </span>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div className="min-w-0">
      <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <pre className="overflow-x-auto rounded-lg bg-muted p-3 font-mono text-[11.5px] text-muted-foreground">
        {value === null || value === undefined ? "-" : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

export default function AuditPage() {
  const [tab, setTab] = useState<"tenant" | "admin">("tenant");
  // ADM-3 (PRD 16): action text applies on submit, the date range instantly.
  const [actionInput, setActionInput] = useState("");
  const [action, setAction] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const params = new URLSearchParams();
  if (tab === "admin") params.set("auditType", "admin");
  if (action) params.set("action", action);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  const { data, loading, error } = useAdminApi<AuditData>(`/api/admin/audit?${qs}`);
  const items = data?.items ?? [];
  const cols = tab === "tenant" ? 5 : 4;

  return (
    <AdminShell title="Audit">
      <PageHead
        eyebrow="Operations"
        title="Audit"
        sub="Activity log, newest first"
        action={
          <div className="flex rounded-full bg-card p-1 ring-1 ring-border">
            {(
              [
                ["tenant", "Tenant activity"],
                ["admin", "Admin actions"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`rounded-full px-3 py-1 text-[13px] transition-colors ${
                  tab === key
                    ? "bg-foreground font-medium text-background"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        }
      />

      {error && (
        <div className="mb-4 rounded-xl border border-border border-l-2 border-l-bad bg-card px-5 py-3 text-[13px] text-bad">
          {error}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setAction(actionInput.trim());
        }}
        className="mb-4 flex flex-wrap items-center gap-2"
      >
        <Input
          value={actionInput}
          onChange={(e) => setActionInput(e.target.value)}
          placeholder="Filter action (e.g. tenant)"
          aria-label="Filter action"
          className="h-9 w-56"
        />
        <Input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          aria-label="From date"
          className="h-9 w-40"
        />
        <Input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          aria-label="To date"
          className="h-9 w-40"
        />
        <Btn type="submit" variant="line">
          Apply
        </Btn>
      </form>

      {!loading && items.length === 0 ? (
        <Empty
          title={tab === "admin" ? "No admin actions yet" : "No tenant activity yet"}
          hint={
            tab === "admin"
              ? "Every change by an operator is recorded here."
              : "Agent and staff activity will appear here."
          }
        />
      ) : (
        <TableCard>
          <table className="ledger">
            <thead>
              <tr>
                <th className="w-44">Time</th>
                <th>Action</th>
                {tab === "tenant" ? (
                  <>
                    <th>Entity</th>
                    <th>Tenant</th>
                    <th>Phone</th>
                  </>
                ) : (
                  <>
                    <th>Admin</th>
                    <th>Target</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <Fragment key={a.id}>
                  <tr>
                    <td className="whitespace-nowrap font-mono text-[12.5px] text-muted-foreground">
                      {new Date(a.createdAt).toLocaleString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td>
                      <Action value={a.action} />
                    </td>
                    {tab === "tenant" ? (
                      <>
                        <td className="text-[12.5px]">
                          {a.entityType}{" "}
                          <span className="font-mono text-muted-foreground">
                            {a.entityId ? `#${a.entityId.slice(0, 8)}` : ""}
                          </span>
                        </td>
                        <td className="text-[12.5px] text-muted-foreground">{a.tenantName}</td>
                        <td className="font-mono text-[12px] text-muted-foreground">
                          {a.customerPhone ?? "-"}
                        </td>
                      </>
                    ) : (
                      <>
                        <td>
                          <div className="text-[13px] font-medium">{a.adminName}</div>
                          <div className="text-[11.5px] text-muted-foreground">{a.adminEmail}</div>
                        </td>
                        <td className="text-[12.5px] text-muted-foreground">
                          {a.targetType}{" "}
                          <span className="font-mono">
                            {a.targetId ? `#${a.targetId.slice(0, 8)}` : ""}
                          </span>
                        </td>
                      </>
                    )}
                  </tr>
                  {(a.beforeValue !== null && a.beforeValue !== undefined) ||
                    (a.afterValue !== null && a.afterValue !== undefined) ? (
                    <tr>
                      <td colSpan={cols} className="border-t-0 pt-0 pb-3">
                        <details>
                          <summary className="cursor-pointer select-none text-[11.5px] text-muted-foreground transition-colors hover:text-foreground">
                            Before / after values
                          </summary>
                          <div className="mt-2 grid gap-3 sm:grid-cols-2">
                            <JsonBlock label="Before" value={a.beforeValue} />
                            <JsonBlock label="After" value={a.afterValue} />
                          </div>
                        </details>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
              {loading && (
                <tr>
                  <td
                    colSpan={cols}
                    className="py-12 text-center text-[13px] text-muted-foreground"
                  >
                    Loading...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TableCard>
      )}

      {data && data.total > data.pageSize && (
        <p className="mt-3 font-mono text-[11.5px] text-muted-foreground">
          Showing {items.length} of {data.total} entries
        </p>
      )}
    </AdminShell>
  );
}
