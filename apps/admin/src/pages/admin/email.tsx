import { type FormEvent, useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import { EnvelopeSimple } from "@phosphor-icons/react";
import { AdminShell } from "@/components/admin-shell";
import { Btn, PageHead } from "@/components/console";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";
import { Input } from "@csq/ui/components/ui/input";
import { Label } from "@csq/ui/components/ui/label";

// Platform email provider (owner request 2026-11-10): the platform SMTP.
// Tenants with their own provider keep using it; every tenant without one
// falls back to this. Staff invites and scenario Email nodes send through it.

type EmailStatus = {
  configured: boolean;
  type?: "SMTP" | "RESEND";
  from?: string;
  host?: string;
  port?: number;
  secure?: boolean;
  username?: string;
  hasSecret?: boolean;
};

const EMPTY_FORM = {
  host: "",
  port: "587",
  secure: false,
  username: "",
  password: "",
  from: "",
};

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

export default function PlatformEmailPage() {
  const { data, loading, error, refresh } = useAdminApi<EmailStatus>(
    "/api/admin/email-settings"
  );
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);
  const [testInfo, setTestInfo] = useState<string | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  // Prefill non-secret fields from the saved config so editing the host or
  // sender never requires re-entering the password.
  useEffect(() => {
    if (data?.configured) {
      setForm((f) => ({
        ...f,
        host: data.host ?? f.host,
        port: data.port !== undefined ? String(data.port) : f.port,
        secure: data.secure ?? f.secure,
        username: data.username ?? f.username,
        from: data.from ?? f.from,
      }));
    }
  }, [data]);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setFormError(null);
    setSaved(false);
    try {
      await adminFetch("/api/admin/email-settings", "PUT", {
        type: "SMTP",
        host: form.host,
        port: form.port,
        secure: form.secure,
        username: form.username,
        // Blank keeps the stored password server-side.
        ...(form.password ? { password: form.password } : {}),
        from: form.from,
      });
      setForm((f) => ({ ...f, password: "" }));
      setSaved(true);
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal menyimpan SMTP platform.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (busy) return;
    setBusy(true);
    setFormError(null);
    setSaved(false);
    try {
      await adminFetch("/api/admin/email-settings", "DELETE");
      setForm(EMPTY_FORM);
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal memutus SMTP platform.");
    } finally {
      setBusy(false);
    }
  }

  async function sendTest(e: FormEvent) {
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
      setTestInfo(`Email tes terkirim ke ${r.to} (ID: ${r.messageId}).`);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : "Gagal mengirim email tes.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <AdminShell title="Email">
      <PageHead
        eyebrow="Konfigurasi"
        title="Email Platform"
        sub="SMTP default untuk semua tenant. SMTP milik tenant sendiri tetap dipakai lebih dulu jika ada."
      />

      {(formError || error) && (
        <div className="mb-4 rounded-xl border border-border border-l-2 border-l-bad bg-card px-5 py-3 text-[13px] text-bad">
          {formError ?? error}
        </div>
      )}
      {saved && (
        <div className="mb-4 rounded-xl border border-border border-l-2 border-l-ok bg-card px-5 py-3 text-[13px] text-ok">
          SMTP platform tersimpan. Email tenant tanpa SMTP sendiri kini terkirim lewat sini.
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-6">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-signal-soft text-primary">
            <EnvelopeSimple size={20} weight="fill" />
          </span>
          <div>
            <p className="text-sm font-medium">
              {loading
                ? "Memuat..."
                : data?.configured
                  ? `Terhubung - ${data.type} ${data.host ? `(${data.host}:${data.port})` : ""}`
                  : "Belum diatur"}
            </p>
            <p className="text-[13px] text-muted-foreground">
              {data?.configured
                ? `Pengirim: ${data.from}`
                : "Undangan staf dan modul Email skenario tidak terkirim otomatis sampai ini diatur (atau tenant mengatur SMTP sendiri)."}
            </p>
          </div>
          {data?.configured && (
            <Btn variant="ghost" disabled={busy} onClick={() => void disconnect()} className="ml-auto hover:text-bad">
              Putuskan
            </Btn>
          )}
        </div>

        <form onSubmit={save} className="max-w-xl space-y-4">
          <div>
            <Label htmlFor="smtp-host">Host SMTP</Label>
            <Input
              id="smtp-host"
              required
              value={form.host}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, host: e.target.value }))}
              placeholder="smtp.gmail.com"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="smtp-port">Port</Label>
              <Input
                id="smtp-port"
                required
                type="number"
                value={form.port}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, port: e.target.value }))}
                placeholder="587"
              />
            </div>
            <div>
              <Label htmlFor="smtp-secure">Keamanan</Label>
              <select
                id="smtp-secure"
                value={form.secure ? "ssl" : "starttls"}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => setForm((f) => ({ ...f, secure: e.target.value === "ssl" }))}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              >
                <option value="starttls">STARTTLS (587)</option>
                <option value="ssl">SSL/TLS (465)</option>
              </select>
            </div>
          </div>
          <div>
            <Label htmlFor="smtp-username">Username</Label>
            <Input
              id="smtp-username"
              required
              value={form.username}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, username: e.target.value }))}
              placeholder="user@domain.com"
            />
          </div>
          <div>
            <Label htmlFor="smtp-password">
              Password {data?.configured && <span className="text-muted-foreground">(kosongkan untuk mempertahankan)</span>}
            </Label>
            <Input
              id="smtp-password"
              type="password"
              required={!data?.configured}
              value={form.password}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, password: e.target.value }))}
              placeholder="••••••••"
            />
          </div>
          <div>
            <Label htmlFor="smtp-from">Alamat pengirim (from)</Label>
            <Input
              id="smtp-from"
              required
              type="email"
              value={form.from}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, from: e.target.value }))}
              placeholder="no-reply@csq.id"
            />
          </div>
          <div className="pt-2">
            <Btn type="submit" disabled={busy}>
              {busy ? "Menyimpan..." : "Simpan SMTP Platform"}
            </Btn>
          </div>
        </form>
      </div>

      {/* Test-send through the saved platform SMTP - the exact provider every
          tenant fallback send uses. */}
      <div className="mt-6 rounded-xl border border-border bg-card p-6">
        <p className="mb-1 text-sm font-medium">Tes Kirim Email</p>
        <p className="mb-4 text-[13px] text-muted-foreground">
          Kirim satu email percobaan melalui SMTP platform yang tersimpan, ke alamat mana pun.
        </p>
        {testInfo && (
          <div className="mb-4 rounded-md border border-ok/40 bg-ok/10 px-4 py-2 text-[13px] text-ok">
            {testInfo}
          </div>
        )}
        {testError && (
          <div className="mb-4 rounded-md border border-bad/40 bg-bad/10 px-4 py-2 text-[13px] text-bad">
            {testError}
          </div>
        )}
        <form onSubmit={sendTest} className="flex max-w-xl items-end gap-3">
          <div className="flex-1">
            <Label htmlFor="test-to">Alamat tujuan</Label>
            <Input
              id="test-to"
              type="email"
              required
              value={testTo}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setTestTo(e.target.value)}
              placeholder="nama@contoh.com"
            />
          </div>
          <Btn type="submit" variant="line" disabled={testing || !data?.configured}>
            {testing ? "Mengirim..." : "Kirim Email Tes"}
          </Btn>
        </form>
      </div>
    </AdminShell>
  );
}
