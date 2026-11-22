import { useState } from "react";
import type { FormEvent } from "react";
import { useRouter } from "next/router";
import { AdminShell } from "@/components/admin-shell";
import { btnPrimary, btnOutline } from "@/components/console";
import { withAdminAuth } from "@/lib/admin-auth";
import { adminFetch } from "@/lib/admin-api";

// Full-page tenant provisioner (template viewTenantCreate 1:1): two-column
// labeled sections instead of a modal.

type Plan = { id: string; name: string; priceIdr: number };

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

export default function TenantCreatePage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = e.currentTarget;
    setBusy(true);
    setFormError(null);
    try {
      const r = await adminFetch<{ slug: string; welcomeEmailSent: boolean }>("/api/admin/tenants", "POST", {
        name: (f.elements.namedItem("nt-name") as HTMLInputElement).value,
        ownerName: (f.elements.namedItem("nt-owner-name") as HTMLInputElement).value,
        ownerEmail: (f.elements.namedItem("nt-owner-email") as HTMLInputElement).value,
        ownerPassword: (f.elements.namedItem("nt-owner-pass") as HTMLInputElement).value,
      });
      sessionStorage.setItem(
        "tenant-notice",
        `Workspace provisioned (Tenant ID: ${r.slug}). ` +
          (r.welcomeEmailSent
            ? "Welcome credentials dispatched via Platform SMTP."
            : "Platform SMTP not configured - hand over credentials manually.")
      );
      router.push("/admin/tenants");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to provision the workspace.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminShell title="New Tenant">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <button type="button" onClick={() => router.push("/admin/tenants")} className="inline-flex items-center gap-1 hover:text-slate-900">
              Tenants
            </button>
            <span className="text-slate-300">/</span>
            <span className="font-medium text-slate-700">New Workspace</span>
          </div>
          <h1 className="mt-1.5 text-xl font-semibold tracking-tight text-slate-900">Provision New Tenant Workspace</h1>
          <p className="mt-1 text-xs text-slate-500">
            Creates an isolated tenant environment, generates a unique alphanumeric slug, and initializes the Owner account.
          </p>
        </div>
        <button type="button" onClick={() => router.push("/admin/tenants")} className={btnOutline("h-8")}>
          Cancel
        </button>
      </div>

      <form onSubmit={submit} className="divide-y divide-slate-200">
        <div className="grid grid-cols-1 gap-y-4 py-6 md:grid-cols-12 md:gap-x-8">
          <div className="md:col-span-4">
            <label className="text-xs font-semibold text-slate-900">Workspace Identity</label>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Official business name displayed in the tenant dashboard. A unique 10-character Tenant ID is generated
              automatically.
            </p>
          </div>
          <div className="max-w-md space-y-3.5 md:col-span-8">
            <div>
              <label htmlFor="nt-name" className="block text-xs font-medium text-slate-700">
                Business / Tenant Name <span className="text-red-500">*</span>
              </label>
              <input
                id="nt-name"
                name="nt-name"
                type="text"
                required
                placeholder="e.g. Toko Kopi Nusantara"
                className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-card px-3 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/15"
              />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-y-4 py-6 md:grid-cols-12 md:gap-x-8">
          <div className="md:col-span-4">
            <label className="text-xs font-semibold text-slate-900">Initial Owner Credentials</label>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Primary administrator account with full access to billing, team management, and AI agents.
            </p>
          </div>
          <div className="max-w-md space-y-3.5 md:col-span-8">
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <div>
                <label htmlFor="nt-owner-name" className="block text-xs font-medium text-slate-700">
                  Owner Full Name <span className="text-red-500">*</span>
                </label>
                <input
                  id="nt-owner-name"
                  name="nt-owner-name"
                  type="text"
                  required
                  placeholder="Budi Santoso"
                  className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-card px-3 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/15"
                />
              </div>
              <div>
                <label htmlFor="nt-owner-email" className="block text-xs font-medium text-slate-700">
                  Owner Email <span className="text-red-500">*</span>
                </label>
                <input
                  id="nt-owner-email"
                  name="nt-owner-email"
                  type="email"
                  required
                  placeholder="owner@tokokopi.id"
                  className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-card px-3 text-sm text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/15"
                />
              </div>
            </div>
            <div>
              <label htmlFor="nt-owner-pass" className="block text-xs font-medium text-slate-700">
                Temporary Password <span className="text-red-500">*</span>
              </label>
              <input
                id="nt-owner-pass"
                name="nt-owner-pass"
                type="text"
                required
                minLength={8}
                placeholder="Minimum 8 characters"
                className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-card px-3 font-mono text-xs text-slate-900 focus:border-emerald-600 focus:outline-none focus:ring-2 focus:ring-emerald-600/15"
              />
            </div>
          </div>
        </div>

        {formError && <p className="py-4 text-xs text-red-600">{formError}</p>}

        <div className="flex items-center justify-end gap-2.5 pt-5">
          <button type="button" onClick={() => router.push("/admin/tenants")} className={btnOutline("px-4 py-2")}>
            Cancel
          </button>
          <button type="submit" disabled={busy} className={btnPrimary("px-4 py-2")}>
            {busy ? "Provisioning..." : "Provision Workspace"}
          </button>
        </div>
      </form>
    </AdminShell>
  );
}
