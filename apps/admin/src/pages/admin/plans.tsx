import { type FormEvent, useState } from "react";
import { Plus, X } from "@phosphor-icons/react";
import {
  PLAN_FEATURE_KEYS,
  PLAN_FEATURE_LABELS,
  type PlanFeature,
} from "@csq/core/types/entitlements";
import { AdminShell } from "@/components/admin-shell";
import { Btn, Empty, PageHead, Section, Status, TableCard } from "@/components/console";
import { Dialog } from "@csq/ui/components/ui/dialog";
import { Select } from "@csq/ui/components/ui/select";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";
import { Input } from "@csq/ui/components/ui/input";
import { Label } from "@csq/ui/components/ui/label";

type Plan = {
  id: string;
  name: string;
  priceIdr: number;
  aiCreditsPerMonth: number | null;
  mauLimit: number | null;
  staffLimit: number | null;
  channelLimit: number | null;
  features: string[];
  tenantCount: number;
};
type PlanList = { items: Plan[] };
type UsageItem = {
  tenantId: string;
  tenantName: string;
  planName: string | null;
  planId: string | null;
  mau: number;
  mauLimit: number | null;
  mauOver: boolean;
  creditsUsed: number;
  creditsLimit: number | null;
  creditsOver: boolean;
  staff: number;
  staffLimit: number | null;
  staffOver: boolean;
  channelCount: number;
  channelLimit: number | null;
  channelOver: boolean;
  mediaBytes: number;
};
type UsageData = { items: UsageItem[]; monthStart: string };

type FormState = {
  name: string;
  priceIdr: string;
  aiCreditsPerMonth: string;
  mauLimit: string;
  staffLimit: string;
  channelLimit: string;
  features: PlanFeature[];
};

const EMPTY_FORM: FormState = {
  name: "",
  priceIdr: "0",
  aiCreditsPerMonth: "",
  mauLimit: "",
  staffLimit: "",
  channelLimit: "",
  features: [],
};

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

function idr(n: number): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function limit(v: number | null): string {
  return v === null ? "Unlimited" : v.toLocaleString("en-GB");
}

function intOrNull(v: string): number | null {
  if (!v.trim()) return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function featureLabels(features: string[]): string {
  const known = PLAN_FEATURE_KEYS.filter((key) => features.includes(key));
  return known.length === 0 ? "Core" : known.map((key) => PLAN_FEATURE_LABELS[key]).join(", ");
}

function UsageCell({
  used,
  max,
  over,
}: {
  used: number;
  max: number | null;
  over: boolean;
}) {
  return (
    <span className={`font-mono tabular-nums ${over ? "font-medium text-bad" : ""}`}>
      {used.toLocaleString("en-GB")}
      {max !== null && ` / ${max.toLocaleString("en-GB")}`}
    </span>
  );
}

// ADM-6 (PRD 16): peak percent across every limited dimension; null when the
// tenant has no limit on anything.
function peakPct(u: UsageItem): number | null {
  const dims: [number, number | null][] = [
    [u.mau, u.mauLimit],
    [u.creditsUsed, u.creditsLimit],
    [u.staff, u.staffLimit],
    [u.channelCount, u.channelLimit],
  ];
  const pcts = dims
    .filter(([, limit]) => limit !== null)
    .map(([used, limit]) => Math.round((used / Math.max(limit ?? 1, 1)) * 100));
  return pcts.length === 0 ? null : Math.max(...pcts);
}

export default function PlansPage() {
  const { data: plansData, loading: pLoading, refresh: refreshPlans } =
    useAdminApi<PlanList>("/api/admin/plans");
  const { data: usageData, loading: uLoading, refresh: refreshUsage } =
    useAdminApi<UsageData>("/api/admin/usage");
  const [busy, setBusy] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Plan | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);

  const plans = plansData?.items ?? [];
  const usage = usageData?.items ?? [];

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setShowForm(true);
  }

  function openEdit(plan: Plan) {
    setEditing(plan);
    setForm({
      name: plan.name,
      priceIdr: String(plan.priceIdr),
      aiCreditsPerMonth: plan.aiCreditsPerMonth === null ? "" : String(plan.aiCreditsPerMonth),
      mauLimit: plan.mauLimit === null ? "" : String(plan.mauLimit),
      staffLimit: plan.staffLimit === null ? "" : String(plan.staffLimit),
      channelLimit: plan.channelLimit === null ? "" : String(plan.channelLimit),
      features: PLAN_FEATURE_KEYS.filter((key) => plan.features.includes(key)),
    });
    setFormError(null);
    setShowForm(true);
  }

  async function submitPlan(e: FormEvent) {
    e.preventDefault();
    setBusy("form");
    setFormError(null);
    const payload = {
      name: form.name,
      priceIdr: parseInt(form.priceIdr, 10) || 0,
      aiCreditsPerMonth: intOrNull(form.aiCreditsPerMonth),
      mauLimit: intOrNull(form.mauLimit),
      staffLimit: intOrNull(form.staffLimit),
      channelLimit: intOrNull(form.channelLimit),
      features: form.features,
    };
    try {
      if (editing) {
        await adminFetch("/api/admin/plans", "PUT", { id: editing.id, ...payload });
      } else {
        await adminFetch("/api/admin/plans", "POST", payload);
      }
      setShowForm(false);
      setForm(EMPTY_FORM);
      setEditing(null);
      refreshPlans();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save the plan.");
    } finally {
      setBusy(null);
    }
  }

  async function assignPlan(tenantId: string, planId: string | null) {
    setBusy(tenantId);
    try {
      await adminFetch("/api/admin/plans", "PATCH", { tenantId, planId });
      refreshPlans();
      refreshUsage();
    } finally {
      setBusy(null);
    }
  }

  function toggleFeature(key: PlanFeature) {
    setForm((f) => ({
      ...f,
      features: f.features.includes(key)
        ? f.features.filter((k) => k !== key)
        : [...f.features, key],
    }));
  }

  return (
    <AdminShell title="Plans & Usage">
      <PageHead
        eyebrow="Configuration"
        title="Plans & Usage"
        sub="AI credits, MAU, seats, channels, and features per plan"
        action={
          <Btn onClick={openCreate}>
            <Plus size={14} weight="bold" />
            New plan
          </Btn>
        }
      />

      <Section title="Available plans" meta={`${plans.length} plans`}>
        {!pLoading && plans.length === 0 ? (
          <Empty
            title="No plans yet"
            hint="Create the first plan to start billing tenants."
          />
        ) : (
          <TableCard>
            <table className="ledger">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="text-right">Price / month</th>
                  <th className="text-right">AI credits</th>
                  <th className="text-right">MAU</th>
                  <th className="text-right">Staff</th>
                  <th className="text-right">Channels</th>
                  <th>Features</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {plans.map((p) => (
                  <tr key={p.id}>
                    <td className="font-medium">{p.name}</td>
                    <td className="text-right font-mono tabular-nums">{idr(p.priceIdr)}</td>
                    <td className="text-right font-mono tabular-nums">
                      {limit(p.aiCreditsPerMonth)}
                    </td>
                    <td className="text-right font-mono tabular-nums">{limit(p.mauLimit)}</td>
                    <td className="text-right font-mono tabular-nums">{limit(p.staffLimit)}</td>
                    <td className="text-right font-mono tabular-nums">
                      {limit(p.channelLimit)}
                    </td>
                    <td className="text-[12.5px] text-muted-foreground">
                      {featureLabels(p.features)}
                    </td>
                    <td className="text-right">
                      <Btn variant="ghost" onClick={() => openEdit(p)}>
                        Edit
                      </Btn>
                    </td>
                  </tr>
                ))}
                {pLoading && (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-[13px] text-muted-foreground">
                      Loading...
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableCard>
        )}
      </Section>

      <Section
        title="Usage this month"
        meta={
          usageData
            ? `since ${new Date(usageData.monthStart).toLocaleDateString("en-GB", {
                day: "numeric",
                month: "short",
              })}`
            : undefined
        }
      >
        {!uLoading && usage.length === 0 ? (
          <Empty title="No tenants yet" hint="Usage appears once tenants are active." />
        ) : (
          <TableCard>
            <table className="ledger">
              <thead>
                <tr>
                  <th>Tenant</th>
                  <th>Plan</th>
                  <th className="text-right">MAU</th>
                  <th className="text-right">AI credits</th>
                  <th className="text-right">Staff</th>
                  <th className="text-right">Channels</th>
                  <th className="text-right">Peak</th>
                  <th className="text-right">Media</th>
                </tr>
              </thead>
              <tbody>
                {usage.map((u) => {
                  const pct = peakPct(u);
                  return (
                  <tr key={u.tenantId}>
                    <td className="font-medium">{u.tenantName}</td>
                    <td>
                      <Select
                        className="h-7 w-auto rounded-sm border border-input bg-card px-2 text-[12.5px] text-muted-foreground"
                        value={u.planId ?? ""}
                        disabled={busy === u.tenantId}
                        onChange={(e) => void assignPlan(u.tenantId, e.target.value || null)}
                        aria-label={`Plan for ${u.tenantName}`}
                      >
                        <option value="">- no plan -</option>
                        {plans.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="text-right">
                      <UsageCell used={u.mau} max={u.mauLimit} over={u.mauOver} />
                    </td>
                    <td className="text-right">
                      <UsageCell
                        used={u.creditsUsed}
                        max={u.creditsLimit}
                        over={u.creditsOver}
                      />
                    </td>
                    <td className="text-right">
                      <UsageCell used={u.staff} max={u.staffLimit} over={u.staffOver} />
                    </td>
                    <td className="text-right">
                      <UsageCell
                        used={u.channelCount}
                        max={u.channelLimit}
                        over={u.channelOver}
                      />
                    </td>
                    <td className="whitespace-nowrap text-right">
                      {pct === null ? (
                        <span className="text-muted-foreground">-</span>
                      ) : (
                        <span className="flex items-center justify-end gap-1.5">
                          <span
                            className={`font-mono tabular-nums ${
                              pct > 100 ? "font-medium text-bad" : "text-muted-foreground"
                            }`}
                          >
                            {pct}%
                          </span>
                          {pct > 100 && <Status tone="bad">Over</Status>}
                        </span>
                      )}
                    </td>
                    <td className="text-right font-mono tabular-nums">
                      {bytes(u.mediaBytes)}
                    </td>
                  </tr>
                  );
                })}
                {uLoading && (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-[13px] text-muted-foreground">
                      Loading...
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </TableCard>
        )}
      </Section>

      <Dialog
        open={showForm}
        onClose={() => setShowForm(false)}
        ariaLabel={editing ? "Edit plan" : "New plan"}
        className="max-w-xl rounded-2xl border-border bg-card p-0 shadow-[0_24px_64px_rgba(0,0,0,0.18)]"
      >
            <div className="flex items-start justify-between border-b border-border px-5 py-4">
              <div>
                <div className="eyebrow mb-1">Configuration</div>
                <h2 className="text-[18px] font-semibold tracking-tight">
                  {editing ? `Edit ${editing.name}` : "New plan"}
                </h2>
              </div>
              <button
                onClick={() => setShowForm(false)}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={submitPlan} className="space-y-4 p-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="p-name">Plan name</Label>
                  <Input
                    id="p-name"
                    required
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Basic"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="p-price">Price per month (IDR)</Label>
                  <Input
                    id="p-price"
                    type="number"
                    required
                    value={form.priceIdr}
                    onChange={(e) => setForm({ ...form, priceIdr: e.target.value })}
                    placeholder="500000"
                  />
                </div>
              </div>

              <div className="border-t border-border pt-4">
                <div className="eyebrow mb-3">Monthly limits</div>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="p-credits" className="text-[11px]">
                      AI credits
                    </Label>
                    <Input
                      id="p-credits"
                      type="number"
                      value={form.aiCreditsPerMonth}
                      onChange={(e) => setForm({ ...form, aiCreditsPerMonth: e.target.value })}
                      placeholder="15000"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="p-mau" className="text-[11px]">
                      MAU
                    </Label>
                    <Input
                      id="p-mau"
                      type="number"
                      value={form.mauLimit}
                      onChange={(e) => setForm({ ...form, mauLimit: e.target.value })}
                      placeholder="1000"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="p-staff" className="text-[11px]">
                      Staff
                    </Label>
                    <Input
                      id="p-staff"
                      type="number"
                      value={form.staffLimit}
                      onChange={(e) => setForm({ ...form, staffLimit: e.target.value })}
                      placeholder="1"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="p-channels" className="text-[11px]">
                      Channels
                    </Label>
                    <Input
                      id="p-channels"
                      type="number"
                      value={form.channelLimit}
                      onChange={(e) => setForm({ ...form, channelLimit: e.target.value })}
                      placeholder="1"
                    />
                  </div>
                </div>
                <p className="mt-2 text-[11.5px] text-muted-foreground">
                  Leave a limit empty for unlimited. Staff excludes the owner. Only connected
                  channels count.
                </p>
              </div>

              <div className="border-t border-border pt-4">
                <div className="eyebrow mb-3">Features</div>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {PLAN_FEATURE_KEYS.map((key) => (
                    <label
                      key={key}
                      className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-[13px] transition-colors hover:bg-accent"
                    >
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 accent-primary"
                        checked={form.features.includes(key)}
                        onChange={() => toggleFeature(key)}
                      />
                      {PLAN_FEATURE_LABELS[key]}
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-[11.5px] text-muted-foreground">
                  Unchecked features are disabled for tenants on this plan.
                </p>
              </div>

              {formError && <p className="text-[13px] text-bad">{formError}</p>}

              <div className="flex justify-end gap-2 pt-1">
                <Btn type="button" variant="line" onClick={() => setShowForm(false)}>
                  Cancel
                </Btn>
                <Btn type="submit" disabled={busy === "form"}>
                  {busy === "form" ? "Saving..." : editing ? "Save" : "Create plan"}
                </Btn>
              </div>
            </form>
      </Dialog>
    </AdminShell>
  );
}
