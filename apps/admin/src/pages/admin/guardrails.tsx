import { Fragment, useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { StatusLabel, Segmented } from "@/components/console";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi } from "@/lib/admin-api";

// Guardrails (template viewGuardrails 1:1): segmented stage filter, expandable
// per-row JSON verdict payload.

type GuardAfter = {
  mode?: string;
  blocked?: boolean;
  retried?: boolean;
  storeIntent?: number;
  injection?: number;
  grounded?: number;
  onTopic?: number;
  revealsInternals?: number;
};
type GuardItem = {
  id: string;
  action: string;
  tenantName: string;
  customerPhone: string | null;
  entityId: string;
  createdAt: string;
  afterValue: GuardAfter | null;
};

function pct(v: number | undefined): string {
  return typeof v === "number" ? `${Math.round(v * 100)}%` : "-";
}

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

export default function GuardrailsPage() {
  const [tab, setTab] = useState("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data, loading, error } = useAdminApi<{ items: GuardItem[] }>(
    `/api/admin/guardrails${tab !== "all" ? `?type=${tab}` : ""}`
  );

  const items = (data?.items ?? []).filter((g) =>
    tab === "all" ? true : (tab === "pre" ? g.action === "guard.pre_block" : g.action === "guard.post_flag")
  );

  return (
    <AdminShell title="Guardrails">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">AI Decision Guardrails</h1>
          <p className="mt-1 text-xs text-slate-500">
            Pre-turn prompt injection detection and post-turn grounding verification telemetry across all active agents.
          </p>
        </div>
        <Segmented
          options={[
            { key: "all", label: "All Turns" },
            { key: "pre", label: "Pre-Turn" },
            { key: "post", label: "Post-Turn" },
          ]}
          value={tab}
          onChange={(k) => {
            setTab(k);
            setExpanded(null);
          }}
        />
      </div>

      {error && (
        <div className="mt-5 rounded-md border border-slate-200 border-l-2 border-l-red-500 bg-card px-4 py-2.5 text-xs text-red-600">
          {error}
        </div>
      )}

      <div className="mt-6 overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-y border-slate-200 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
              <th className="py-3 pr-4">Timestamp</th>
              <th className="px-4 py-3">Stage</th>
              <th className="px-4 py-3">Tenant &amp; Sender</th>
              <th className="px-4 py-3">Classifier Scores</th>
              <th className="px-4 py-3">Verdict</th>
              <th className="py-3 pl-4 text-right">Payload</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 border-b border-slate-200">
            {loading && (
              <tr>
                <td colSpan={6} className="py-10 text-center text-xs text-slate-400">
                  Loading...
                </td>
              </tr>
            )}
            {items.map((g) => {
              const v = g.afterValue;
              const isPre = g.action === "guard.pre_block";
              const isOpen = expanded === g.id;
              return (
                <Fragment key={g.id}>
                  <tr className="hover:bg-slate-50/80">
                    <td className="whitespace-nowrap py-3.5 pr-4 font-mono text-slate-500">
                      {new Date(g.createdAt).toLocaleString("en-GB", {
                        day: "2-digit",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className="rounded border border-slate-200 bg-muted px-2 py-0.5 font-mono text-[11px] font-medium text-slate-700">
                        {isPre ? "Pre" : "Post"}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <p className="font-semibold text-slate-900">{g.tenantName}</p>
                      <p className="font-mono text-[11px] text-slate-400">{g.customerPhone ?? "-"}</p>
                    </td>
                    <td className="px-4 py-3.5 font-mono text-slate-700">
                      {v
                        ? isPre
                          ? `intent ${pct(v.storeIntent)} / inj ${pct(v.injection)}`
                          : `ground ${pct(v.grounded)} / topic ${pct(v.onTopic)} / internal ${pct(v.revealsInternals)}`
                        : "-"}
                    </td>
                    <td className="px-4 py-3.5">
                      {v ? (
                        <StatusLabel tone="warn">
                          {isPre ? (v.blocked ? "Rejected" : "Would reject") : v.retried ? "Retried" : "Flagged"}
                          {v.mode ? ` (${v.mode})` : ""}
                        </StatusLabel>
                      ) : (
                        <StatusLabel tone="off">No data</StatusLabel>
                      )}
                    </td>
                    <td className="py-3.5 pl-4 text-right">
                      <button
                        type="button"
                        onClick={() => setExpanded(isOpen ? null : g.id)}
                        className="font-medium text-emerald-700 hover:underline"
                      >
                        {isOpen ? "Hide JSON" : "Inspect JSON"}
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr className="bg-muted/80">
                      <td colSpan={6} className="px-4 py-3">
                        <pre className="overflow-x-auto rounded border border-slate-200 bg-slate-900 p-3 font-mono text-[11px] leading-relaxed text-slate-200">
                          {JSON.stringify(v, null, 2)}
                        </pre>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {!loading && items.length === 0 && !error && (
              <tr>
                <td colSpan={6} className="py-10 text-center text-xs text-slate-400">
                  No guard flags yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </AdminShell>
  );
}
