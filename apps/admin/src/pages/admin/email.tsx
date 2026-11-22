import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { AdminShell } from "@/components/admin-shell";
import { StatusLabel, btnPrimary, btnOutline } from "@/components/console";
import { showToast } from "@/components/toast";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";

// Platform default SMTP (template viewEmail 1:1): two-column settings form,
// connected status chip, disconnect + test send.

type EmailStatus = {
  configured: boolean;
  type?: "SMTP" | "RESEND";
  from?: string;
  host?: string;
  port?: number;
  secure?: boolean;
  username?: string;
};

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

export default function PlatformEmailPage() {
  const { data, loading, error, refresh } = useAdminApi<EmailStatus>("/api/admin/email-settings");
  const [form, setForm] = useState({ host: "", port: "587", secure: false, username: "", password: "", from: "" });
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);
  const [testInfo, setTestInfo] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    if (!data?.configured) return;
    setForm((f) => ({
      ...f,
      host: data.host ?? f.host,
      port: data.port !== undefined ? String(data.port) : f.port,
      secure: data.secure ?? f.secure,
      username: data.username ?? f.username,
      from: data.from ?? f.from,
    }));
  }, [data]);

  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await adminFetch("/api/admin/email-settings", "PUT", {
        type: "SMTP",
        host: form.host,
        port: form.port,
        secure: form.secure,
        username: form.username,
        ...(form.password ? { password: form.password } : {}),
        from: form.from,
      });
      setForm((f) => ({ ...f, password: "" }));
      showToast("Platform SMTP saved");
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to save the platform SMTP.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setFormError(null);
    try {
      await adminFetch("/api/admin/email-settings", "DELETE");
      setForm({ host: "", port: "587", secure: false, username: "", password: "", from: "" });
      showToast("Platform SMTP disconnected");
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to disconnect.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (testing || !testTo.trim()) return;
    setTesting(true);
    setTestError(null);
    setTestInfo(null);
    try {
      const r = await adminFetch<{ sent: true; to: string; messageId: string }>(
        "/api/admin/email-settings/test",
        "POST",
        { to: testTo.trim() }
      );
      setTestInfo(`Test email sent to ${r.to} (ID: ${r.messageId}).`);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : "Failed to send the test email.");
    } finally {
      setTesting(false);
    }
  }

  const bind = (key: "host" | "port" | "username" | "password" | "from") => ({
    value: form[key],
    onChange: (e: ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value }),
  });

  return (
    <AdminShell title="Platform Email">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900">Platform Default SMTP</h1>
          <p className="mt-1 text-xs text-slate-500">
            Global fallback mail relay for tenant invitations, password resets, and scenario email actions.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {loading ? (
            <StatusLabel tone="off">Loading...</StatusLabel>
          ) : data?.configured ? (
            <StatusLabel tone="ok">
              Connected ({data.host}:{data.port})
            </StatusLabel>
          ) : (
            <StatusLabel tone="warn">Not Configured</StatusLabel>
          )}
          {data?.configured && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void disconnect()}
              className="text-xs font-medium text-red-600 hover:underline disabled:opacity-40"
            >
              Disconnect
            </button>
          )}
        </div>
      </div>

      {(formError || error) && (
        <div className="mt-5 rounded-md border border-slate-200 border-l-2 border-l-red-500 bg-card px-4 py-2.5 text-xs text-red-600">
          {formError ?? error}
        </div>
      )}

      <form onSubmit={save} className="divide-y divide-slate-200">
        <div className="grid grid-cols-1 gap-y-4 py-6 md:grid-cols-12 md:gap-x-8">
          <div className="md:col-span-4">
            <span className="text-xs font-semibold text-slate-900">SMTP Server Endpoint</span>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Tenant-level custom SMTP gateways still override this global relay when configured.
            </p>
          </div>
          <div className="max-w-md space-y-3.5 md:col-span-8">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label htmlFor="smtp-host" className="block text-xs font-medium text-slate-700">
                  SMTP Host <span className="text-red-500">*</span>
                </label>
                <input
                  id="smtp-host"
                  type="text"
                  required
                  placeholder="smtp.gmail.com"
                  className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-card px-3 font-mono text-xs text-slate-900 focus:border-emerald-600 focus:outline-none"
                  {...bind("host")}
                />
              </div>
              <div>
                <label htmlFor="smtp-port" className="block text-xs font-medium text-slate-700">
                  Port <span className="text-red-500">*</span>
                </label>
                <input
                  id="smtp-port"
                  type="number"
                  required
                  className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-card px-3 font-mono text-xs text-slate-900 focus:border-emerald-600 focus:outline-none"
                  {...bind("port")}
                />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="smtp-username" className="block text-xs font-medium text-slate-700">
                  Username <span className="text-red-500">*</span>
                </label>
                <input
                  id="smtp-username"
                  type="text"
                  required
                  placeholder="user@domain.com"
                  className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-card px-3 text-xs text-slate-900 focus:border-emerald-600 focus:outline-none"
                  {...bind("username")}
                />
              </div>
              <div>
                <label htmlFor="smtp-password" className="block text-xs font-medium text-slate-700">
                  Password {data?.configured ? <span className="text-slate-400">(leave blank to keep)</span> : <span className="text-red-500">*</span>}
                </label>
                <input
                  id="smtp-password"
                  type="password"
                  required={!data?.configured}
                  placeholder="&bull;&bull;&bull;&bull;&bull;&bull;&bull;&bull;"
                  className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-card px-3 text-xs text-slate-900 focus:border-emerald-600 focus:outline-none"
                  {...bind("password")}
                />
              </div>
            </div>
            <div>
              <label htmlFor="smtp-secure" className="block text-xs font-medium text-slate-700">
                Security
              </label>
              <select
                id="smtp-secure"
                value={form.secure ? "ssl" : "starttls"}
                onChange={(e) => setForm({ ...form, secure: e.target.value === "ssl" })}
                className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-card px-3 text-xs text-slate-900 focus:border-emerald-600 focus:outline-none"
              >
                <option value="starttls">STARTTLS (587)</option>
                <option value="ssl">SSL/TLS (465)</option>
              </select>
            </div>
            <div>
              <label htmlFor="smtp-from" className="block text-xs font-medium text-slate-700">
                Default From Address <span className="text-red-500">*</span>
              </label>
              <input
                id="smtp-from"
                type="email"
                required
                placeholder="no-reply@csq.id"
                className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-card px-3 text-xs text-slate-900 focus:border-emerald-600 focus:outline-none"
                {...bind("from")}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2.5 py-5">
          <button
            type="button"
            disabled={!data?.configured}
            onClick={() => {
              setTestTo("");
              setTestError(null);
              setTestInfo(null);
              document.getElementById("test-to")?.focus();
            }}
            className={btnOutline("px-3.5 py-2")}
          >
            Send Test Email
          </button>
          <button type="submit" disabled={busy} className={btnPrimary("px-4 py-2")}>
            {busy ? "Saving..." : "Save Platform SMTP"}
          </button>
        </div>
      </form>

      {/* Test-send section */}
      <div className="mt-6 rounded-md border border-slate-200 p-4">
        <p className="text-xs font-semibold text-slate-900">Send a test email</p>
        <p className="mt-0.5 text-xs text-slate-500">
          Sends one test message through the saved platform SMTP, to any address.
        </p>
        {testInfo && (
          <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
            {testInfo}
          </div>
        )}
        {testError && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">
            {testError}
          </div>
        )}
        <form onSubmit={sendTest} className="mt-3 flex max-w-xl items-end gap-2.5">
          <div className="flex-1">
            <label htmlFor="test-to" className="block text-xs font-medium text-slate-700">
              Recipient
            </label>
            <input
              id="test-to"
              type="email"
              required
              value={testTo}
              onChange={(e) => setTestTo(e.target.value)}
              placeholder="name@example.com"
              className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-card px-3 text-xs text-slate-900 focus:border-emerald-600 focus:outline-none"
            />
          </div>
          <button type="submit" disabled={testing || !data?.configured} className={btnOutline("px-3.5 py-2")}>
            {testing ? "Sending..." : "Send Test"}
          </button>
        </form>
      </div>
    </AdminShell>
  );
}
