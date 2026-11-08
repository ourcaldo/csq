import type { FormEvent } from "react";
import { useState } from "react";
import Head from "next/head";
import { signIn } from "next-auth/react";
import { Button } from "@csq/ui/components/ui/button";
import { Input } from "@csq/ui/components/ui/input";
import { Label } from "@csq/ui/components/ui/label";

// Admin login - the operator realm's only public page (PRD 13). A tenant
// credential never validates here: this form posts to the admin auth
// endpoint backed by the AdminUser table.

export default function AdminLogin() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
    setBusy(false);
    if (result?.ok) {
      window.location.href = "/admin";
    } else {
      setError("Email atau password salah.");
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F6F7F9] px-4">
      <Head>
        <title>Masuk - CSQ Admin</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>

      <div className="w-full max-w-[360px]">
        <div className="mb-8 flex items-center gap-2.5">
          <span className="flex h-6 w-6 items-center justify-center rounded bg-green-700 text-[11px] font-bold text-white">
            C
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-slate-900">
            CSQ Admin
          </span>
        </div>

        <h1 className="text-[20px] font-semibold tracking-tight text-slate-900">Masuk</h1>
        <p className="mt-1 text-[13px] text-slate-500">
          Konsol operator platform. Akun tenant tidak berlaku di sini.
        </p>

        <form onSubmit={submit} className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operator@csq.id"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="text-[13px] text-red-600">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Memeriksa..." : "Masuk"}
          </Button>
        </form>
      </div>
    </main>
  );
}
