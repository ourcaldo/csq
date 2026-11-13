import { Fragment, useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { Btn, Empty, PageHead, Status, TableCard } from "@/components/console";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi } from "@/lib/admin-api";
import { Input } from "@csq/ui/components/ui/input";

// Guardrail monitor (PRD 03 amendment 2026-11-13): the decision-model guard
// logs guard.pre_block (off-topic / injection inbound) and guard.post_flag
// (ungrounded / off-scope / internals-leaking reply) to the tenant AuditLog.
// This page is the shadow-mode tuning view: verdict, guard mode, and the raw
// probabilities, newest first. Only flagged turns are logged, so every row
// here is a candidate false positive to review before flipping
// GUARD_MODE=enforce.

type GuardAfter = {
  mode?: string;
  blocked?: boolean;
  retried?: boolean;
  storeIntent?: number;
  injection?: number;
  grounded?: number;
  onTopic?: number;
  revealsInternals?: number;
  at?: string;
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
type GuardData = {
  items: GuardItem[];
  total: number;
  page: number;
  pageSize: number;
};

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

function pct(v: number | undefined): string {
  return typeof v === "number" ? `${Math.round(v * 100)}%` : "-";
}

function Verdict({ item }: { item: GuardItem }) {
  const v = item.afterValue;
  if (!v) return <Status tone="off">Tanpa data</Status>;
  if (item.action === "guard.pre_block") {
    return v.blocked ? (
      <Status tone="bad">Ditolak</Status>
    ) : (
      <Status tone="warn">Akan ditolak</Status>
    );
  }
  // A retried row carries the RETRY's numbers (the loop logs the final
  // verdict), so the Nilai column shows where the retry landed.
  return v.retried ? (
    <Status tone="warn">Direset ulang</Status>
  ) : (
    <Status tone="warn">Ditandai</Status>
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

export default function GuardrailsPage() {
  const [tab, setTab] = useState<"all" | "pre" | "post">("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const params = new URLSearchParams();
  if (tab === "pre") params.set("type", "pre");
  if (tab === "post") params.set("type", "post");
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const qs = params.toString();
  const { data, loading, error } = useAdminApi<GuardData>(
    `/api/admin/guardrails${qs ? `?${qs}` : ""}`
  );
  const items = data?.items ?? [];
  const cols = 7;

  return (
    <AdminShell title="Guardrail">
      <PageHead
        eyebrow="Operasi"
        title="Guardrail"
        sub="Penanda guard model keputusan, terbaru di atas"
        action={
          <div className="flex rounded-full bg-card p-1 ring-1 ring-border">
            {(
              [
                ["all", "Semua"],
                ["pre", "Pra-balasan"],
                ["post", "Pasca-balasan"],
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
          // Date filters apply instantly - the inputs are already in state.
        }}
        className="mb-4 flex flex-wrap items-center gap-2"
      >
        <Input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          aria-label="Dari tanggal"
          className="h-9 w-40"
        />
        <Input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          aria-label="Sampai tanggal"
          className="h-9 w-40"
        />
        <Btn type="submit" variant="line">
          Terapkan
        </Btn>
      </form>

      {!loading && items.length === 0 ? (
        <Empty
          title="Belum ada penanda guard"
          hint="Baru muncul saat guard menandai pesan atau balasan - uji dengan chat off-topic di clone."
        />
      ) : (
        <TableCard>
          <table className="ledger">
            <thead>
              <tr>
                <th className="w-44">Waktu</th>
                <th>Tipe</th>
                <th>Tenant</th>
                <th>Nomor</th>
                <th>Nilai</th>
                <th>Mode</th>
                <th>Hasil</th>
              </tr>
            </thead>
            <tbody>
              {items.map((g) => {
                const v = g.afterValue;
                const isPre = g.action === "guard.pre_block";
                return (
                  <Fragment key={g.id}>
                    <tr>
                      <td className="whitespace-nowrap font-mono text-[12.5px] text-muted-foreground">
                        {new Date(g.createdAt).toLocaleString("id-ID", {
                          day: "2-digit",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="text-[12.5px]">{isPre ? "Pra" : "Pasca"}</td>
                      <td className="text-[12.5px]">{g.tenantName}</td>
                      <td className="font-mono text-[12px] text-muted-foreground">
                        {g.customerPhone ?? "-"}
                      </td>
                      <td className="whitespace-nowrap font-mono text-[12px] text-muted-foreground">
                        {v
                          ? isPre
                            ? `intent ${pct(v.storeIntent)} / inj ${pct(v.injection)}`
                            : `ground ${pct(v.grounded)} / topik ${pct(v.onTopic)} / internal ${pct(v.revealsInternals)}`
                          : "-"}
                      </td>
                      <td className="text-[12.5px] text-muted-foreground">
                        {v?.mode ?? "-"}
                      </td>
                      <td>
                        <Verdict item={g} />
                      </td>
                    </tr>
                    {v ? (
                      <tr>
                        <td colSpan={cols} className="border-t-0 pt-0 pb-3">
                          <details>
                            <summary className="cursor-pointer select-none text-[11.5px] text-muted-foreground transition-colors hover:text-foreground">
                              Data lengkap (chat #{g.entityId.slice(0, 8)})
                            </summary>
                            <div className="mt-2 max-w-xl">
                              <JsonBlock label="Verdict guard" value={v} />
                            </div>
                          </details>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
              {loading && (
                <tr>
                  <td
                    colSpan={cols}
                    className="py-12 text-center text-[13px] text-muted-foreground"
                  >
                    Memuat...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TableCard>
      )}

      {data && data.total > data.pageSize && (
        <p className="mt-3 font-mono text-[11.5px] text-muted-foreground">
          Menampilkan {items.length} dari {data.total} entri
        </p>
      )}
    </AdminShell>
  );
}
