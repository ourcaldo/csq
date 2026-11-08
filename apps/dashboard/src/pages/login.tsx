import { useState } from "react";
import type { FormEvent } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/auth/auth-shell";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const res = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (!res || res.error) {
      setError("Email atau password salah. Coba lagi.");
      return;
    }
    router.push("/dashboard");
  }

  return (
    <AuthShell
      title="Masuk"
      subtitle="Selamat datang kembali."
      footer={
        <>
          Belum punya akun?{" "}
          <Link href="/register" className="font-semibold text-green-700 hover:text-green-800">
            Daftar
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {error && (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="kamu@usaha.id"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="•••••••••"
          />
        </div>
        <Button type="submit" disabled={loading} className="bg-green-600 hover:bg-green-700">
          {loading ? "Memproses…" : "Masuk"}
        </Button>
      </form>
    </AuthShell>
  );
}
