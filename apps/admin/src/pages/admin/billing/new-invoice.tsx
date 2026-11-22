import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/router";
import { AdminShell } from "@/components/admin-shell";
import { idr, btnPrimary, btnOutline } from "@/components/console";
import { showToast } from "@/components/toast";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";

// Full-page invoice composer (template viewInvoiceCreate 1:1).

type Tenant = { tenantId: string; tenantName: string; planId: string | null };
type Plan = { id: string; name: string; priceIdr: number };

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

export default function InvoiceCreatePage() {
  const router = useRouter();
  const { data: usageData } = useAdminApi<{ items: Tenant[] }>("/api/admin/usage");
  const { data: plansData } = useAdminApi<{ items: Plan[] }>("/api/admin/plans");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const tenants = usageData?.items ?? [];
  const plans = plansData?.items ?? [];
  const prefillTenant = typeof router.query.tenant === "string" ? router.query.tenant : "";
  const month = new Date();
  const period = `1 ${month.toLocaleString("en-GB", { month: "short" })} - ${month.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = e.currentTarget;
    setBusy(true);
    setFormError(null);
    try {
      await adminFetch("/api/admin/invoices", "POST", {
        tenantId: (f.elements.namedItem("ni-tenant") as HTMLSelectElement).value,
        planId: (f.elements.namedItem("ni-plan") as HTMLSelectElement).value || null,
        period: `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}`,
        amountIdr: parseInt((f.elements.namedItem("ni-amount") as HTMLInputElement).value, 10) || 0,
      });
      showToast("Invoice issued");
      router.push("/admin/billing");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to issue the invoice.");
    } finally {
      setBusy(false);
    }
  }

  const inpCls = "mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-card px-3 text-xs text-slate-900 focus:border-emerald-600 focus:outline-none";

  return (
    <AdminShell title="Issue Invoice">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <button
              type="button"
              onClick={() => router.push("/admin/billing")}
              className="inline-flex items-center gap-1 hover:text-slate-900"
            >
              Billing
            </button>
            <span className="text-slate-300">/</span>
            <span className="font-medium text-slate-700">Issue Invoice</span>
          </div>
          <h1 className="mt-1.5 text-xl font-semibold tracking-tight text-slate-900">Issue Tenant Invoice</h1>
          <p className="mt-1 text-xs text-slate-500">
            Generates a numbered billing statement visible immediately inside the tenant&apos;s Paket &amp; Kuota ledger.
          </p>
        </div>
        <button type="button" onClick={() => router.push("/admin/billing")} className={btnOutline("h-8")}>
          Cancel
        </button>
      </div>

      <form onSubmit={submit} className="divide-y divide-slate-200">
        <div className="grid grid-cols-1 gap-y-4 py-6 md:grid-cols-12 md:gap-x-8">
          <div className="md:col-span-4">
            <label className="text-xs font-semibold text-slate-900">Billed Workspace</label>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Select the recipient tenant workspace and applicable subscription plan.
            </p>
          </div>
          <div className="grid max-w-lg grid-cols-1 gap-3.5 sm:grid-cols-2 md:col-span-8">
            <div>
              <label htmlFor="ni-tenant" className="block text-xs font-medium text-slate-700">
                Tenant Workspace <span className="text-red-500">*</span>
              </label>
              <select
                id="ni-tenant"
                name="ni-tenant"
                required
                defaultValue={prefillTenant || tenants[0]?.tenantId || ""}
                className={inpCls}
              >
                <option value="">- select a tenant -</option>
                {tenants.map((t) => (
                  <option key={t.tenantId} value={t.tenantId}>
                    {t.tenantName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="ni-plan" className="block text-xs font-medium text-slate-700">
                Plan Reference
              </label>
              <select id="ni-plan" name="ni-plan" defaultValue="" className={inpCls}>
                <option value="">Manual</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({idr(p.priceIdr)})
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-y-4 py-6 md:grid-cols-12 md:gap-x-8">
          <div className="md:col-span-4">
            <label className="text-xs font-semibold text-slate-900">Amount &amp; Due Date</label>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">Invoice total in IDR; the due date follows the platform due-days setting.</p>
          </div>
          <div className="grid max-w-xl grid-cols-1 gap-3.5 sm:grid-cols-3 md:col-span-8">
            <div>
              <label className="block text-xs font-medium text-slate-700">Period</label>
              <input type="text" value={period} readOnly className={`${inpCls} text-slate-500`} />
            </div>
            <div>
              <label htmlFor="ni-amount" className="block text-xs font-medium text-slate-700">
                Amount (IDR) <span className="text-red-500">*</span>
              </label>
              <input
                id="ni-amount"
                name="ni-amount"
                type="number"
                min={0}
                step={1000}
                required
                defaultValue="199000"
                className={`${inpCls} font-mono`}
              />
            </div>
          </div>
        </div>

        {formError && <p className="py-4 text-xs text-red-600">{formError}</p>}

        <div className="flex items-center justify-end gap-2.5 pt-5">
          <button type="button" onClick={() => router.push("/admin/billing")} className={btnOutline("px-4 py-2")}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className={btnPrimary("px-4 py-2")}>
            {busy ? "Issuing..." : "Issue Invoice"}
          </button>
        </div>
      </form>
    </AdminShell>
  );
}
