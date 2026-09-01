// Email integration section of the Settings page (OWNER-only — the parent
// guards rendering). Per-tenant delivery config for the scenario Email module:
// the store owner brings their own provider — SMTP (host/port/user/pass) or
// Resend (API key). Secrets are write-only: the GET returns masked status, so
// the form pre-fills the non-secret fields and leaves the secret blank ("keep
// the saved one") unless the owner types a new value.
import { useEffect, useState } from "react";
import {
  EnvelopeSimple,
  FloppyDisk,
  PaperPlaneRight,
  XCircle,
  CheckCircle,
  WarningCircle,
} from "@phosphor-icons/react";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { StateNotice } from "@/components/dashboard/state-notice";
import { BadgeStatus } from "@/components/dashboard/badge-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

// Mirrors the masked GET shape from /api/dashboard/settings/email.
type EmailStatus =
  | { configured: false }
  | {
      configured: true;
      type: "SMTP" | "RESEND";
      from: string;
      host?: string;
      port?: number;
      secure?: boolean;
      username?: string;
      hasSecret: true;
    };

type ProviderType = "SMTP" | "RESEND";

export function EmailSection() {
  const { data: status, loading, error, refresh } = useApi<EmailStatus>(
    "/api/dashboard/settings/email"
  );

  const [providerType, setProviderType] = useState<ProviderType>("SMTP");
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

  // Hydrate the form from the masked status once it loads (and on refresh).
  // Secret fields stay empty — the server keeps the stored one unless a new
  // value is typed.
  useEffect(() => {
    if (!status || !status.configured) {
      setProviderType("SMTP");
      setFrom("");
      setHost("");
      setPort("587");
      setSecure("false");
      setUsername("");
      setPassword("");
      setApiKey("");
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

  async function onSave() {
    setSaving(true);
    setFormError(null);
    setSaved(false);
    setTestInfo(null);
    try {
      const body: Record<string, unknown> =
        providerType === "SMTP"
          ? {
              type: "SMTP",
              host,
              port,
              secure: secure === "true",
              username,
              password,
              from,
            }
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

  const configured = status?.configured === true;

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 md:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-100 text-cyan-700">
            <EnvelopeSimple size={20} />
          </span>
          <div>
            <h2 className="text-base font-semibold text-slate-900">Email</h2>
            <p className="mt-0.5 text-sm text-slate-500">
              Integrasi email usaha Anda untuk modul Email pada Skenario —
              kirim konfirmasi pesanan dan follow-up ke email pelanggan.
              Gunakan SMTP Anda sendiri atau Resend.
            </p>
          </div>
        </div>
        <BadgeStatus tone={configured ? "green" : "neutral"}>
          {configured ? "Terhubung" : "Belum diatur"}
        </BadgeStatus>
      </div>

      <Separator className="my-4" />

      {loading && <StateNotice variant="loading" message="Memuat pengaturan email…" />}
      {error && <StateNotice variant="error" message={error} />}
      {formError && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <WarningCircle size={18} className="mt-0.5 shrink-0" />
          <span>{formError}</span>
        </div>
      )}
      {saved && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-green-600/40 bg-green-600/10 p-3 text-sm text-green-700">
          <CheckCircle size={18} className="mt-0.5 shrink-0" />
          <span>Konfigurasi email tersimpan.</span>
        </div>
      )}
      {testInfo && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-green-600/40 bg-green-600/10 p-3 text-sm text-green-700">
          <CheckCircle size={18} className="mt-0.5 shrink-0" />
          <span>{testInfo}</span>
        </div>
      )}

      {!loading && !error && (
        <div className="space-y-3">
          <div>
            <Label htmlFor="email-provider" className="text-xs">
              Penyedia
            </Label>
            <Select
              id="email-provider"
              value={providerType}
              onChange={(e) => setProviderType(e.target.value === "RESEND" ? "RESEND" : "SMTP")}
            >
              <option value="SMTP">SMTP (server email Anda sendiri)</option>
              <option value="RESEND">Resend (API key)</option>
            </Select>
          </div>

          <div>
            <Label htmlFor="email-from" className="text-xs">
              Alamat Pengirim
            </Label>
            <Input
              id="email-from"
              value={from}
              placeholder="Toko Kopi Nusantara <no-reply@tokokopi.id>"
              onChange={(e) => setFrom(e.target.value)}
            />
            <p className="mt-1 text-[11px] text-slate-400">
              Untuk Resend, gunakan domain yang sudah diverifikasi di akun Resend Anda.
            </p>
          </div>

          {providerType === "SMTP" ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <Label htmlFor="email-host" className="text-xs">
                    Host SMTP
                  </Label>
                  <Input
                    id="email-host"
                    value={host}
                    placeholder="smtp.gmail.com"
                    onChange={(e) => setHost(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="email-port" className="text-xs">
                    Port
                  </Label>
                  <Input
                    id="email-port"
                    type="number"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="email-secure" className="text-xs">
                  Keamanan
                </Label>
                <Select
                  id="email-secure"
                  value={secure}
                  onChange={(e) => setSecure(e.target.value)}
                >
                  <option value="false">STARTTLS (587)</option>
                  <option value="true">SSL/TLS implisit (465)</option>
                </Select>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="email-username" className="text-xs">
                    Username
                  </Label>
                  <Input
                    id="email-username"
                    value={username}
                    autoComplete="off"
                    onChange={(e) => setUsername(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="email-password" className="text-xs">
                    Password
                  </Label>
                  <Input
                    id="email-password"
                    type="password"
                    value={password}
                    autoComplete="new-password"
                    placeholder={
                      status?.configured && status.type === "SMTP" ? "••• (tersimpan)" : ""
                    }
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>
            </>
          ) : (
            <div>
              <Label htmlFor="email-apikey" className="text-xs">
                API Key Resend
              </Label>
              <Input
                id="email-apikey"
                type="password"
                value={apiKey}
                autoComplete="new-password"
                placeholder={
                  status?.configured && status.type === "RESEND" ? "••• (tersimpan)" : "re_…"
                }
                onChange={(e) => setApiKey(e.target.value)}
              />
              <p className="mt-1 text-[11px] text-slate-400">
                Buat API key di dashboard Resend (resend.com/api-keys).
              </p>
            </div>
          )}

          <div className="flex flex-wrap justify-end gap-2 pt-2">
            {configured && (
              <Button
                type="button"
                variant="outline"
                disabled={disconnecting}
                onClick={onDisconnect}
              >
                <XCircle size={16} />
                {disconnecting ? "Memutus…" : "Putuskan"}
              </Button>
            )}
            {configured && (
              <Button type="button" variant="outline" disabled={testing} onClick={onTest}>
                <PaperPlaneRight size={16} />
                {testing ? "Mengirim…" : "Kirim Email Tes"}
              </Button>
            )}
            <Button type="button" disabled={saving} onClick={onSave}>
              <FloppyDisk size={16} />
              {saving ? "Menyimpan…" : "Simpan"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
