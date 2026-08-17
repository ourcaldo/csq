import { useState } from "react";
import type { FormEvent } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Button } from "@/components/ui/button";

type FormState = {
  businessName: string;
  name: string;
  email: string;
  password: string;
};

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({
    businessName: "",
    name: "",
    email: "",
    password: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function update(field: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json();
    if (!data.success) {
      setLoading(false);
      setError(data.error?.message ?? "Registrasi gagal.");
      return;
    }

    // Auto sign-in after registration.
    const si = await signIn("credentials", {
      email: form.email,
      password: form.password,
      redirect: false,
    });
    setLoading(false);
    if (!si || si.error) {
      router.push("/login");
      return;
    }
    router.push("/dashboard");
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <form onSubmit={onSubmit} className="flex w-full max-w-sm flex-col gap-4">
        <h1 className="text-xl font-semibold">Daftar UMKM</h1>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <label className="flex flex-col gap-1 text-sm">
          Nama Usaha
          <input
            required
            value={form.businessName}
            onChange={(e) => update("businessName", e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Nama Anda
          <input
            required
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Email
          <input
            type="email"
            required
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Password
          <input
            type="password"
            required
            minLength={8}
            value={form.password}
            onChange={(e) => update("password", e.target.value)}
            className="rounded-md border border-input bg-background px-3 py-2"
          />
        </label>
        <Button type="submit" disabled={loading}>
          {loading ? "Memproses…" : "Daftar"}
        </Button>
        <p className="text-sm text-muted-foreground">
          Sudah punya akun?{" "}
          <Link href="/login" className="text-primary underline">
            Masuk
          </Link>
        </p>
      </form>
    </main>
  );
}
