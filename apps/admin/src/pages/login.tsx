import type { FormEvent } from "react";
import { useState } from "react";
import Head from "next/head";
import { signIn } from "next-auth/react";
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
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <Head>
        <title>Masuk - CSQ Console</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>

      <div className="w-full max-w-[380px]">
        <div className="mb-8 flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-[11px] font-bold text-primary-foreground">
            C
          </span>
          <span className="text-[15px] font-semibold tracking-tight">
            CSQ <span className="font-normal text-muted-foreground">Console</span>
          </span>
        </div>

        <div className="eyebrow mb-1.5">Operator</div>
        <h1 className="text-[28px] font-bold leading-tight tracking-tight">Masuk</h1>
        <p className="mt-1 text-[13.5px] text-muted-foreground">
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
          {error && <p className="text-[13px] text-bad">{error}</p>}
          <button
            type="submit"
            disabled={busy}
            className="inline-flex h-9 w-full items-center justify-center rounded-full bg-foreground px-4 text-[13px] font-medium text-background transition-colors hover:bg-foreground/85 disabled:pointer-events-none disabled:opacity-50"
          >
            {busy ? "Memeriksa..." : "Masuk"}
          </button>
        </form>
      </div>
    </main>
  );
}
