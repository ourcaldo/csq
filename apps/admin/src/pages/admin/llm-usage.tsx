import { useState } from "react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AdminShell } from "@/components/admin-shell";
import {
  StatCell,
  StatusLabel,
  SectionLabel,
  idr,
  pad,
} from "@/components/console";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi } from "@/lib/admin-api";

// LLM usage and cost (PRD 33): month-scoped spend from the write-time cost
// snapshots. Operator-only margin data - the page only surfaces it.

type LlmTotals = {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  costIdr: number;
  unpricedCalls: number;
  missingFxCalls: number;
  replies: number;
  costPerReply: number | null;
};
type LlmModel = {
  model: string;
  calls: number;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  costIdr: number;
  sharePct: number;
  hasPrice: boolean;
  unpricedCalls: number;
};
type LlmTenant = {
  tenantId: string;
  tenantName: string;
  planName: string | null;
  planPriceIdr: number | null;
  replies: number;
  calls: number;
  costIdr: number;
  costPerReply: number | null;
  costPercentOfPlan: number | null;
  unpricedCalls: number;
};
type LlmPrice = { model: string; inputUsdPer1M: string; outputUsdPer1M: string; updatedAt: string };
type FxRate = { date: string; usdIdr: string; source: string };
type LlmData = {
  month: string;
  monthStart: string;
  monthEnd: string;
  firstRecordedAt: string | null;
  totals: LlmTotals;
  daily: { date: string; costIdr: number }[];
  models: LlmModel[];
  tenants: LlmTenant[];
  prices: LlmPrice[];
  fx: { current: FxRate | null; rates: FxRate[] };
};

function monthLabel(m: string): string {
  const d = new Date(`${m}-01T00:00:00.000Z`);
  return d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
}

function monthOptions(first: string | null | undefined): string[] {
  const now = new Date();
  const end = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}`;
  if (!first) return [end];
  const out: string[] = [];
  const start = new Date(first);
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  while (`${y}-${pad(m + 1)}` <= end) {
    out.push(`${y}-${pad(m + 1)}`);
    m += 1;
    if (m > 11) {
      m = 0;
      y += 1;
    }
  }
  return out.length > 0 ? out : [end];
}

function usd(n: number): string {
  return `$${n.toFixed(4)}`;
}


export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));
export default function LlmUsagePage() {
  const [month, setMonth] = useState("");
  const [sortDesc, setSortDesc] = useState(true);

  const { data, loading, error } = useAdminApi<LlmData>(
    `/api/admin/llm-usage${month ? `?month=${month}` : ""}`
  );

  const totals = data?.totals;
  const months = monthOptions(data?.firstRecordedAt);
  const selected = month || data?.month || months[months.length - 1];
  const tenants = [...(data?.tenants ?? [])].sort((a, b) =>
    sortDesc ? b.costIdr - a.costIdr : a.costIdr - b.costIdr
  );
  const daily = data?.daily ?? [];
  const fx = data?.fx;

  return (
    <AdminShell title="LLM Usage">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">LLM Usage &amp; Cost</h1>
          <p className="mt-1 text-xs text-slate-500">
            Provider spend per model and tenant. Model prices and the USD/IDR rate are synced automatically; each call keeps the price and rate snapshot of its own day.
          </p>
        </div>
        <select
          value={selected}
          onChange={(e) => setMonth(e.target.value)}
          aria-label="Select month"
          className="h-9 rounded-md border border-slate-300 bg-card px-3 text-xs font-medium text-slate-800 focus:border-emerald-600 focus:outline-none"
        >
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <div className="mt-5 rounded-md border border-slate-200 border-l-2 border-l-red-500 bg-card px-4 py-2.5 text-xs text-red-600">
          {error}
        </div>
      )}

      {/* Stat strip */}
      <div className="mt-6 grid grid-cols-2 border-y border-slate-200 sm:grid-cols-4 sm:divide-x sm:divide-slate-200 lg:grid-cols-7">
        <div className="py-3.5 pr-4">
          <StatCell
            label="Month Cost"
            value={loading && !totals ? "-" : idr(Math.round(totals?.costIdr ?? 0))}
            sub={totals ? `${usd(totals.costUsd)} total` : "USD total"}
          />
        </div>
        <div className="py-3.5 pr-4 sm:px-5">
          <StatCell label="Calls" value={(totals?.calls ?? 0).toLocaleString("en-GB")} />
        </div>
        <div className="border-t border-slate-200 py-3.5 pr-4 sm:border-t-0 sm:px-5">
          <StatCell label="Prompt Tokens" value={(totals?.promptTokens ?? 0).toLocaleString("en-GB")} />
        </div>
        <div className="border-t border-slate-200 py-3.5 pr-4 sm:border-t-0 sm:px-5">
          <StatCell
            label="Completion Tokens"
            value={(totals?.completionTokens ?? 0).toLocaleString("en-GB")}
          />
        </div>
        <div className="border-t border-slate-200 py-3.5 pr-4 sm:border-t-0 sm:px-5">
          <StatCell
            label="Cost / AI Reply"
            value={totals && totals.costPerReply !== null ? idr(Math.round(totals.costPerReply)) : "-"}
            sub={`${(totals?.replies ?? 0).toLocaleString("en-GB")} AI replies`}
          />
        </div>
        <div className="border-t border-slate-200 py-3.5 pr-4 sm:border-t-0 sm:px-5">
          <StatCell
            label="Unpriced Calls"
            value={(totals?.unpricedCalls ?? 0).toLocaleString("en-GB")}
            valueClass={(totals?.unpricedCalls ?? 0) > 0 ? "text-amber-700" : "text-slate-900"}
            sub="no price row"
          />
        </div>
        <div className="border-t border-slate-200 py-3.5 sm:border-t-0 sm:pl-5">
          <StatCell
            label="Missing-FX Calls"
            value={(totals?.missingFxCalls ?? 0).toLocaleString("en-GB")}
            valueClass={(totals?.missingFxCalls ?? 0) > 0 ? "text-red-700" : "text-slate-900"}
            sub="costIdr not set"
          />
        </div>
      </div>

      {totals && totals.calls === 0 && (
        <p className="mt-3 text-xs text-slate-400">No LLM usage recorded for this month yet.</p>
      )}

      {/* Daily cost chart */}
      <div className="border-b border-slate-200 py-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Daily LLM Cost ({monthLabel(selected)})
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              IDR cost per day from the per-call cost snapshots.
            </p>
          </div>
        </div>
        <div className="mt-4 h-40">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={daily} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#e2e8f0" strokeDasharray="3 3" />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fill: "#94a3b8", fontFamily: "JetBrains Mono, monospace" }}
                tickFormatter={(v: string) => {
                  const parts = v.split("-");
                  return parts.length === 3 ? `${parts[2]}/${parts[1]}` : v;
                }}
                interval={4}
                minTickGap={12}
              />
              <YAxis
                width={44}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 10, fill: "#94a3b8", fontFamily: "JetBrains Mono, monospace" }}
                tickFormatter={(v: number) =>
                  Intl.NumberFormat("en-US", { notation: "compact" }).format(Number(v))
                }
              />
              <Tooltip
                cursor={{ fill: "rgba(148, 163, 184, 0.12)" }}
                contentStyle={{
                  borderRadius: 6,
                  border: "1px solid #e2e8f0",
                  fontSize: 11,
                  fontFamily: "JetBrains Mono, monospace",
                  boxShadow: "0 4px 12px rgba(15, 23, 42, 0.08)",
                }}
                formatter={(value) => [idr(Number(value ?? 0)), "LLM cost"]}
                labelFormatter={(label) =>
                  new Date(String(label)).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })
                }
              />
              <Bar dataKey="costIdr" fill="#16a34a" radius={[3, 3, 0, 0]} maxBarSize={16} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Model breakdown */}
      <div className="pt-6">
        <SectionLabel>Model Breakdown</SectionLabel>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-y border-slate-200 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                <th className="py-3 pr-4">Model</th>
                <th className="px-3 py-3 text-right">Calls</th>
                <th className="px-3 py-3 text-right">Tokens In / Out</th>
                <th className="px-3 py-3 text-right">Cost USD</th>
                <th className="px-3 py-3 text-right">Cost IDR</th>
                <th className="px-3 py-3 text-right">Share</th>
                <th className="px-3 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 border-b border-slate-200">
              {(data?.models ?? []).map((m) => (
                <tr key={m.model} className="hover:bg-slate-50/80">
                  <td className="py-3 pr-4 font-mono text-[11px] font-medium text-slate-900">{m.model}</td>
                  <td className="px-3 py-3 text-right font-mono text-slate-700 tabular-nums">
                    {m.calls.toLocaleString("en-GB")}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-slate-700 tabular-nums">
                    {m.promptTokens.toLocaleString("en-GB")} / {m.completionTokens.toLocaleString("en-GB")}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-slate-700 tabular-nums">{usd(m.costUsd)}</td>
                  <td className="px-3 py-3 text-right font-mono text-slate-900 tabular-nums">
                    {idr(Math.round(m.costIdr))}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-slate-700 tabular-nums">
                    {m.sharePct.toFixed(1)}%
                  </td>
                  <td className="px-3 py-3">
                    {m.hasPrice ? (
                      <StatusLabel tone="ok">Priced</StatusLabel>
                    ) : (
                      <StatusLabel tone="warn">Unpriced ({m.unpricedCalls})</StatusLabel>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && (data?.models ?? []).length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-xs text-slate-400">
                    No model usage for this month.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {(data?.prices ?? []).length > 0 && (
          <p className="mt-2 text-[11px] text-slate-500">
            Prices synced automatically (USD per 1M tokens):{" "}
            {(data?.prices ?? [])
              .map((p) => `${p.model} (in $${p.inputUsdPer1M} / out $${p.outputUsdPer1M})`)
              .join(", ")}
          </p>
        )}
      </div>

      {/* FX rates */}
      <div className="mt-8 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-1">
          <SectionLabel>USD / IDR Rate</SectionLabel>
          <div className="rounded-md border border-slate-200 p-4">
            {fx?.current ? (
              <>
                <p className="font-mono text-lg font-semibold text-slate-900 tabular-nums">
                  {idr(Number(fx.current.usdIdr))}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  <span className="rounded border border-slate-200 bg-muted px-2 py-0.5 font-mono text-[10px] font-medium uppercase text-slate-600">
                    {fx.current.source}
                  </span>
                  <span className="font-mono text-[11px] text-slate-400">{fx.current.date}</span>
                </div>
                <p className="mt-4 border-t border-slate-100 pt-3 text-[11px] text-slate-500">
                  Synced automatically every day by the worker. Each call keeps the rate of its own day.
                </p>
              </>
            ) : (
              <p className="text-xs text-slate-400">No FX rate recorded yet. Calls get no IDR cost until one exists.</p>
            )}
          </div>
        </div>
        <div className="lg:col-span-2">
          <SectionLabel>Last 30 Days</SectionLabel>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-y border-slate-200 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  <th className="py-2.5 pr-4">Date</th>
                  <th className="px-4 py-2.5 text-right">Rate (IDR / USD)</th>
                  <th className="py-2.5 pl-4">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 border-b border-slate-200">
                {(fx?.rates ?? []).map((r) => (
                  <tr key={r.date} className="hover:bg-slate-50/80">
                    <td className="py-2.5 pr-4 font-mono text-slate-600">{r.date}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-slate-900 tabular-nums">
                      {idr(Number(r.usdIdr))}
                    </td>
                    <td className="py-2.5 pl-4">
                      <StatusLabel tone={r.source === "MANUAL" ? "warn" : "ok"}>{r.source}</StatusLabel>
                    </td>
                  </tr>
                ))}
                {!loading && (fx?.rates ?? []).length === 0 && (
                  <tr>
                    <td colSpan={3} className="py-8 text-center text-xs text-slate-400">
                      No rates recorded in the last 30 days.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Per-tenant cost */}
      <div className="mt-8">
        <SectionLabel>Cost by Tenant</SectionLabel>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-y border-slate-200 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                <th className="py-3 pr-4">Tenant</th>
                <th className="px-3 py-3">Plan</th>
                <th className="px-3 py-3 text-right">AI Replies</th>
                <th className="px-3 py-3 text-right">Calls</th>
                <th className="px-3 py-3 text-right">
                  <button
                    type="button"
                    onClick={() => setSortDesc((d) => !d)}
                    className="uppercase tracking-wider hover:text-slate-700"
                    title="Sort by cost"
                  >
                    Cost IDR {sortDesc ? "↓" : "↑"}
                  </button>
                </th>
                <th className="px-3 py-3 text-right">Cost / Reply</th>
                <th className="px-3 py-3 text-right">% of Plan Price</th>
                <th className="py-3 pl-3">Unpriced</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 border-b border-slate-200">
              {tenants.map((t) => (
                <tr key={t.tenantId} className="hover:bg-slate-50/80">
                  <td className="py-3 pr-4">
                    <Link
                      href={`/admin/tenants/${t.tenantId}`}
                      className="font-semibold text-slate-900 hover:text-emerald-700"
                    >
                      {t.tenantName}
                    </Link>
                  </td>
                  <td className="px-3 py-3">
                    <p className="font-medium text-slate-700">{t.planName ?? "None"}</p>
                    {t.planPriceIdr !== null && (
                      <p className="font-mono text-[10px] text-slate-400">{idr(t.planPriceIdr)}/mo</p>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-slate-700 tabular-nums">
                    {t.replies.toLocaleString("en-GB")}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-slate-700 tabular-nums">
                    {t.calls.toLocaleString("en-GB")}
                  </td>
                  <td className="px-3 py-3 text-right font-mono font-semibold text-slate-900 tabular-nums">
                    {idr(Math.round(t.costIdr))}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-slate-700 tabular-nums">
                    {t.costPerReply === null ? "-" : idr(Math.round(t.costPerReply))}
                  </td>
                  <td className="px-3 py-3 text-right font-mono tabular-nums">
                    {t.costPercentOfPlan === null ? (
                      <span className="text-slate-400">-</span>
                    ) : (
                      <span className={t.costPercentOfPlan > 100 ? "font-semibold text-red-600" : "text-slate-700"}>
                        {t.costPercentOfPlan.toFixed(1)}%
                      </span>
                    )}
                  </td>
                  <td className="py-3 pl-3">
                    {t.unpricedCalls > 0 ? (
                      <StatusLabel tone="warn">{t.unpricedCalls} unpriced</StatusLabel>
                    ) : (
                      <StatusLabel tone="ok">Priced</StatusLabel>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && tenants.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-xs text-slate-400">
                    No tenants yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AdminShell>
  );
}
