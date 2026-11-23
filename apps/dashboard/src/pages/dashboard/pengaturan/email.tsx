// /dashboard/pengaturan/email - the reference's Gateway Email section.
// Same API as the old EmailSection (PUT/DELETE + test), new presentation:
// segmented provider switch, divide-y rows, putuskan + test + save footer.
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { GetServerSideProps } from "next";
import { withAuth } from "@csq/core/lib/auth";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { SettingsShell } from "@/components/dashboard/settings/settings-shell";
import { cn } from "@csq/ui/lib/utils";

type EmailStatus =
  | { configured: false; platformConfigured?: boolean }
  | {
      configured: true;
      type: "SMTP" | "RESEND";
      from: string;
      host?: string;
      port?: number;
      secure?: boolean;
      username?: string;
      hasSecret: true;
      platformConfigured?: boolean;
    };

export default function PengaturanEmailPage() {
  const { data: status, loading, error, refresh } = useApi<EmailStatus>(
    "/api/dashboard/settings/email"
  );

  const [providerType, setProviderType] = useState<"SMTP" | "RESEND">("SMTP");
  const [from, setFrom] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("587");
  const [secure, setSecure] = useState("false");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [apiKey, setApiKey] = useState("");

  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [testInfo, setTestInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!status || !status.configured) {
      setProviderType("SMTP");
      setFrom("");
      setHost("");
      setPort("587");
      setSecure("false");
      setUsername("");
      return;
    }
    setProviderType(status.type);
    setFrom(status.from);
    if (status.type === "SMTP") {
      setHost(status.host ?? "");
      setPort(String(status.port ?? 587));
      setSecure(status.secure ? "true" : "false");
      setUsername(status.username ?? "");
    }
    setPassword("");
    setApiKey("");
  }, [status]);

  const configured = status?.configured === true;

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setFormError(null);
    setSaved(false);
    setTestInfo(null);
    try {
      const body: Record<string, unknown> =
        providerType === "SMTP"
          ? { type: "SMTP", host, port, secure: secure === "true", username, password, from }
          : { type: "RESEND", apiKey, from };
      await apiSend("/api/dashboard/settings/email", "PUT", body);
      setSaved(true);
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal menyimpan konfigurasi email.");
    } finally {
      setSaving(false);
    }
  }

  async function onTest() {
    if (testing) return;
    setTesting(true);
    setFormError(null);
    setTestInfo(null);
    try {
      const res = await apiSend<{ sent: true; to: string }>(
        "/api/dashboard/settings/email/test",
        "POST"
      );
      setTestInfo(`Email tes terkirim ke ${res.to}. Periksa kotak masuk (dan folder spam).`);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal mengirim email tes.");
    } finally {
      setTesting(false);
    }
  }

  async function onDisconnect() {
    if (disconnecting) return;
    setDisconnecting(true);
    setFormError(null);
    setSaved(false);
    setTestInfo(null);
    try {
      await apiSend("/api/dashboard/settings/email", "DELETE");
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal memutus integrasi email.");
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <SettingsShell
      section="email"
      title="Gateway Pengiriman Email"
      description="Konfigurasi server keluar untuk modul aksi Email pada Skenario otomatis (konfirmasi pesanan, faktur, dan follow-up)."
      headerExtra={
        <span className="inline-flex items-center gap-1.5 font-mono text-xs text-slate-600">
          {configured ? (
            <>
              <span className="h-2 w-2 rounded-full bg-green-500" />
              Terhubung ({status?.type})
            </>
          ) : (
            <>
              <span className="h-2 w-2 rounded-full bg-amber-400" />
              Relay Bawaan Platform
            </>
          )}
        </span>
      }
    >
      <form onSubmit={onSave} className="divide-y divide-slate-200">
        {/* Provider selection */}
        <div className="grid grid-cols-1 gap-y-4 py-6 md:grid-cols-12 md:gap-x-8">
          <div className="md:col-span-4">
            <span className="text-xs font-semibold text-slate-900">Protokol & Penyedia</span>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Pilih server SMTP internal perusahaan atau layanan API transaksional Resend.
            </p>
          </div>
          <div className="space-y-4 md:col-span-8">
            <div className="inline-flex rounded-md border border-slate-300 bg-slate-50 p-0.5">
              {(["SMTP", "RESEND"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setProviderType(p)}
                  className={cn(
                    "rounded px-4 py-1.5 text-xs transition",
                    providerType === p
                      ? "bg-white font-semibold text-green-700 shadow-2xs"
                      : "font-medium text-slate-500 hover:text-slate-900"
                  )}
                >
                  {p === "SMTP" ? "Custom SMTP" : "Resend API"}
                </button>
              ))}
            </div>

            <div>
              <label htmlFor="email-from" className="block text-xs font-medium text-slate-700">
                Identitas Pengirim (From Header)
              </label>
              <input
                id="email-from"
                type="text"
                required
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                placeholder="Toko Kopi Nusantara <no-reply@tokokopi.id>"
                className="mt-1.5 h-9 w-full max-w-md rounded-md border border-slate-300 bg-white px-3 text-sm focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600/15"
              />
              <p className="mt-1 text-[11px] text-slate-400">
                Pastikan domain pengirim memiliki catatan SPF dan DKIM yang valid.
              </p>
            </div>
          </div>
        </div>

        {/* Credentials */}
        <div className="grid grid-cols-1 gap-y-4 py-6 md:grid-cols-12 md:gap-x-8">
          <div className="md:col-span-4">
            <span className="text-xs font-semibold text-slate-900">Kredensial Server</span>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Kredensial disimpan terenkripsi di workspace Anda. Kosongkan password untuk menyimpan yang sudah tersimpan.
            </p>
          </div>
          <div className="md:col-span-8">
            {loading && <p className="text-sm text-slate-500">Memuat pengaturan email...</p>}
            {error && <p className="text-sm text-red-600">{error}</p>}
            {formError && <p className="mb-3 text-sm text-red-600">{formError}</p>}
            {saved && <p className="mb-3 text-sm font-medium text-green-700">Konfigurasi email tersimpan.</p>}
            {testInfo && <p className="mb-3 text-sm font-medium text-green-700">{testInfo}</p>}

            {!loading && !error && providerType === "SMTP" && (
              <div className="max-w-md space-y-3.5">
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label htmlFor="smtp-host" className="block text-xs font-medium text-slate-700">Host SMTP</label>
                    <input
                      id="smtp-host"
                      type="text"
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                      placeholder="smtp.gmail.com"
                      className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-white px-3 font-mono text-xs focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600/15"
                    />
                  </div>
                  <div>
                    <label htmlFor="smtp-port" className="block text-xs font-medium text-slate-700">Port</label>
                    <input
                      id="smtp-port"
                      type="number"
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-white px-3 font-mono text-xs focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600/15"
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="smtp-tls" className="block text-xs font-medium text-slate-700">Mode Keamanan Transport</label>
                  <select
                    id="smtp-tls"
                    value={secure}
                    onChange={(e) => setSecure(e.target.value)}
                    className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-xs focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600/15"
                  >
                    <option value="false">STARTTLS (Direkomendasikan - Port 587)</option>
                    <option value="true">SSL / TLS Implisit (Port 465)</option>
                  </select>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label htmlFor="smtp-user" className="block text-xs font-medium text-slate-700">Username</label>
                    <input
                      id="smtp-user"
                      type="text"
                      value={username}
                      autoComplete="off"
                      onChange={(e) => setUsername(e.target.value)}
                      className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-xs focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600/15"
                    />
                  </div>
                  <div>
                    <label htmlFor="smtp-pass" className="block text-xs font-medium text-slate-700">Password / App Password</label>
                    <input
                      id="smtp-pass"
                      type="password"
                      value={password}
                      autoComplete="new-password"
                      placeholder={configured && status?.type === "SMTP" ? "(saved)" : ""}
                      onChange={(e) => setPassword(e.target.value)}
                      className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-xs focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600/15"
                    />
                  </div>
                </div>
              </div>
            )}

            {!loading && !error && providerType === "RESEND" && (
              <div className="max-w-md space-y-2">
                <label htmlFor="resend-key" className="block text-xs font-medium text-slate-700">Resend API Key</label>
                <input
                  id="resend-key"
                  type="password"
                  value={apiKey}
                  autoComplete="new-password"
                  placeholder="re_live_..."
                  onChange={(e) => setApiKey(e.target.value)}
                  className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 font-mono text-xs focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600/15"
                />
                <p className="text-[11px] text-slate-400">
                  Dapatkan API key dengan izin <code className="font-mono text-slate-600">Sending access</code> dari dashboard Resend.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-end gap-2.5 pt-5">
          {configured && (
            <button
              type="button"
              onClick={() => void onDisconnect()}
              disabled={disconnecting}
              className="rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              {disconnecting ? "Memutus..." : "Putuskan"}
            </button>
          )}
          {configured && (
            <button
              type="button"
              onClick={() => void onTest()}
              disabled={testing}
              className="rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              {testing ? "Mengirim..." : "Kirim Email Pengujian"}
            </button>
          )}
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-green-600 px-4 py-2 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
          >
            {saving ? "Menyimpan..." : "Simpan Gateway Email"}
          </button>
        </div>
      </form>
    </SettingsShell>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth(
  async () => ({ props: {} }),
  { requiredPermission: "pengaturan.kelola" }
);
