import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Button } from "@csq/ui/components/ui/button";
import { Input } from "@csq/ui/components/ui/input";
import { Label } from "@csq/ui/components/ui/label";
import { AuthShell } from "@/components/auth/auth-shell";
import { apiFetch, apiSend } from "@/lib/api-client";

// FEA-5 (PRD 16): public set-password page for a one-time invite token. The
// link is emailed or relayed by the owner before any account exists, so this
// page lives outside /dashboard and the token is resolved server-side; the
// invitee only ever types their own name and password here.

export default function AcceptInvitePage() {
  const router = useRouter();
  const token = typeof router.query.token === "string" ? router.query.token : "";

  const [email, setEmail] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!token) {
      setLoadError("Tautan undangan tidak valid.");
      return;
    }
    apiFetch<{ email: string }>(`/api/team/accept?token=${encodeURIComponent(token)}`)
      .then((info) => setEmail(info.email))
      .catch((err) =>
        setLoadError(err instanceof Error ? err.message : "Undangan tidak valid.")
      );
  }, [token]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password minimal 8 karakter.");
      return;
    }
    if (password !== confirm) {
      setError("Konfirmasi password tidak sama.");
      return;
    }
    setSaving(true);
    try {
      await apiSend("/api/team/accept", "POST", { token, password, name });
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengaktifkan akun.");
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <AuthShell title="Akun Aktif">
        <div className="flex flex-col gap-4">
          <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
            Akun aktif. Silakan masuk.
          </p>
          <Link
            href="/login"
            className="block rounded-lg bg-green-600 px-3 py-2 text-center text-sm font-semibold text-white hover:bg-green-700"
          >
            Masuk
          </Link>
        </div>
      </AuthShell>
    );
  }

  if (loadError) {
    return (
      <AuthShell title="Undangan Tidak Valid">
        <div className="flex flex-col gap-4">
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {loadError}
          </p>
          <Link
            href="/login"
            className="text-sm font-semibold text-green-700 hover:text-green-800"
          >
            Kembali ke halaman masuk
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Aktifkan Akun"
      subtitle="Anda diundang bergabung ke tim CSQ. Buat password untuk mengaktifkan akun Anda."
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="accept-email">Email</Label>
          <Input id="accept-email" value={email ?? "Memuat…"} disabled readOnly />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="accept-name">Nama</Label>
          <Input
            id="accept-name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nama Anda"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="accept-password">Password</Label>
          <Input
            id="accept-password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimal 8 karakter"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="accept-confirm">Konfirmasi Password</Label>
          <Input
            id="accept-confirm"
            type="password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Ulangi password"
          />
        </div>
        <Button
          type="submit"
          disabled={saving || email === null}
          className="bg-green-600 hover:bg-green-700"
        >
          {saving ? "Menyimpan…" : "Aktifkan Akun"}
        </Button>
      </form>
    </AuthShell>
  );
}
