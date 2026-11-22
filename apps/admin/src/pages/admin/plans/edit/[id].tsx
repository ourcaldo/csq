import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/router";
import { AdminShell } from "@/components/admin-shell";
import { btnPrimary, btnOutline } from "@/components/console";
import { showToast } from "@/components/toast";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";

// Full-page plan editor (template viewPlanEditor 1:1): serves both
// /admin/plans/new and /admin/plans/edit/[id]. Two-column labeled sections.

type Plan = {
  id: string;
  name: string;
  priceIdr: number;
  aiCreditsPerMonth: number | null;
  mauLimit: number | null;
  staffLimit: number | null;
  channelLimit: number | null;
  features: string[];
};

const FEATURE_LABELS: Record<string, string> = {
  KNOWLEDGE_BASE: "Knowledge Base",
  SHEETS_SYNC: "Google Sheets Sync",
  CAMPAIGNS: "Campaigns",
  PIPELINE: "Pipeline",
  API_ACCESS: "API Access",
  PRIORITY_SUPPORT: "Priority Support",
};
const FEATURE_KEYS = Object.keys(FEATURE_LABELS);

export const getServerSideProps = withAdminAuth<{ editId?: string }>(async (ctx) => ({
  props: { editId: ctx.params?.id ? String(ctx.params.id) : undefined },
}));

export default function PlanEditorPage({ editId }: { editId?: string }) {
  const router = useRouter();
  const editing = Boolean(editId);
  // Only fetch when editing; the new route skips the fetch entirely.
  const { data } = useAdminApi<{ items: Plan[] }>(editing ? "/api/admin/plans" : "/noop");
  const existing = editing ? (data?.items ?? []).find((p) => p.id === editId) ?? null : null;

  const [form, setForm] = useState({
    name: "",
    priceIdr: "",
    credits: "",
    mau: "",
    staff: "",
    channels: "",
  });
  const [features, setFeatures] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!existing) return;
    setForm({
      name: existing.name,
      priceIdr: String(existing.priceIdr),
      credits: existing.aiCreditsPerMonth === null ? "" : String(existing.aiCreditsPerMonth),
      mau: existing.mauLimit === null ? "" : String(existing.mauLimit),
      staff: existing.staffLimit === null ? "" : String(existing.staffLimit),
      channels: existing.channelLimit === null ? "" : String(existing.channelLimit),
    });
    setFeatures(existing.features);
  }, [existing]);

  // Known plan not found yet -> keep the form empty rather than flashing wrong data.
  if (editing && data && !existing) {
    return (
      <AdminShell title="Plan Editor">
        <p className="text-xs text-slate-400">Plan not found.</p>
      </AdminShell>
    );
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    const intOrNull = (v: string) => (v.trim() === "" ? null : Number(v));
    const payload = {
      name: form.name,
      priceIdr: parseInt(form.priceIdr, 10) || 0,
      aiCreditsPerMonth: intOrNull(form.credits),
      mauLimit: intOrNull(form.mau),
      staffLimit: intOrNull(form.staff),
      channelLimit: intOrNull(form.channels),
      features,
    };
    try {
      if (editing) {
        await adminFetch("/api/admin/plans", "PUT", { id: editId, ...payload });
        showToast(`Plan "${payload.name}" updated`);
      } else {
        await adminFetch("/api/admin/plans", "POST", payload);
        showToast(`Plan "${payload.name}" created`);
      }
      router.push("/admin/plans");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save the plan.");
    } finally {
      setBusy(false);
    }
  }

  const inp = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value }),
  });

  return (
    <AdminShell title={editing ? "Plan Editor" : "New Plan"}>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <button
              type="button"
              onClick={() => router.push("/admin/plans")}
              className="inline-flex items-center gap-1 hover:text-slate-900"
            >
              Plans &amp; Usage
            </button>
            <span className="text-slate-300">/</span>
            <span className="font-medium text-slate-700">{editing ? `Edit ${existing?.name ?? ""}` : "New Plan Tier"}</span>
          </div>
          <h1 className="mt-1.5 text-xl font-semibold tracking-tight text-slate-900">
            {editing ? `Configure "${existing?.name ?? ""}" Tier` : "Create Subscription Plan Tier"}
          </h1>
          <p className="mt-1 text-xs text-slate-500">Set monthly recurring pricing, resource caps, and module entitlements.</p>
        </div>
        <button type="button" onClick={() => router.push("/admin/plans")} className={btnOutline("h-8")}>
          Cancel
        </button>
      </div>

      <form onSubmit={submit} className="divide-y divide-slate-200">
        <div className="grid grid-cols-1 gap-y-4 py-6 md:grid-cols-12 md:gap-x-8">
          <div className="md:col-span-4">
            <label className="text-xs font-semibold text-slate-900">Tier Identity &amp; Pricing</label>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Public tier title and base monthly invoice rate in Indonesian Rupiah.
            </p>
          </div>
          <div className="grid max-w-lg grid-cols-1 gap-3.5 sm:grid-cols-2 md:col-span-8">
            <div>
              <label htmlFor="pe-name" className="block text-xs font-medium text-slate-700">
                Plan Name <span className="text-red-500">*</span>
              </label>
              <input
                id="pe-name"
                type="text"
                required
                placeholder="e.g. Scale"
                className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-card px-3 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none"
                {...inp("name")}
              />
            </div>
            <div>
              <label htmlFor="pe-price" className="block text-xs font-medium text-slate-700">
                Price / Month (IDR) <span className="text-red-500">*</span>
              </label>
              <input
                id="pe-price"
                type="number"
                min={0}
                step={1000}
                required
                placeholder="750000"
                className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-card px-3 font-mono text-sm text-slate-900 focus:border-emerald-600 focus:outline-none"
                {...inp("priceIdr")}
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-y-4 py-6 md:grid-cols-12 md:gap-x-8">
          <div className="md:col-span-4">
            <span className="text-xs font-semibold text-slate-900">Monthly Capacity Caps</span>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Leave any field blank to grant unlimited capacity for that resource.
            </p>
          </div>
          <div className="grid max-w-xl grid-cols-2 gap-3.5 sm:grid-cols-4 md:col-span-8">
            {(
              [
                ["credits", "AI Credits"],
                ["mau", "MAU Contacts"],
                ["staff", "Staff Seats"],
                ["channels", "WA Channels"],
              ] as const
            ).map(([key, label]) => (
              <div key={key}>
                <label htmlFor={`pe-${key}`} className="block text-xs font-medium text-slate-700">
                  {label}
                </label>
                <input
                  id={`pe-${key}`}
                  type="number"
                  min={0}
                  placeholder="Unlimited"
                  className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-card px-3 font-mono text-xs text-slate-900 focus:border-emerald-600 focus:outline-none"
                  {...inp(key)}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-y-4 py-6 md:grid-cols-12 md:gap-x-8">
          <div className="md:col-span-4">
            <span className="text-xs font-semibold text-slate-900">Module Entitlements</span>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Features unlocked inside the tenant workspace for subscribers on this plan.
            </p>
          </div>
          <div className="grid max-w-2xl grid-cols-1 gap-2 sm:grid-cols-3 md:col-span-8">
            {FEATURE_KEYS.map((key) => (
              <label
                key={key}
                className="flex cursor-pointer items-center gap-2 rounded-md border border-slate-200 bg-card px-3 py-2 text-xs text-slate-800 hover:bg-slate-50"
              >
                <input
                  type="checkbox"
                  checked={features.includes(key)}
                  onChange={() =>
                    setFeatures((f) => (f.includes(key) ? f.filter((k) => k !== key) : [...f, key]))
                  }
                  className="h-3.5 w-3.5 rounded border-slate-300 accent-emerald-600"
                />
                <span>{FEATURE_LABELS[key]}</span>
              </label>
            ))}
          </div>
        </div>

        {formError && <p className="py-4 text-xs text-red-600">{formError}</p>}

        <div className="flex items-center justify-end gap-2.5 pt-5">
          <button type="button" onClick={() => router.push("/admin/plans")} className={btnOutline("px-4 py-2")}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className={btnPrimary("px-4 py-2")}>
            {busy ? "Saving..." : editing ? "Save Changes" : "Create Plan"}
          </button>
        </div>
      </form>
    </AdminShell>
  );
}
