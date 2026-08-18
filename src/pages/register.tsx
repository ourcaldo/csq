import { useState } from "react";
import type { FormEvent } from "react";
import { signIn } from "next-auth/react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthShell } from "@/components/auth/auth-shell";

type FormState = {
  businessName: string;
  name: string;
  email: string;
  password: string;
};

const EMPTY: FormState = { businessName: "", name: "", email: "", password: "" };

export default function RegisterPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>(EMPTY);
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
    <AuthShell
      title="Daftar UMKM"
      subtitle="Buat akun untuk usaha Anda."
      footer={
        <>
          Sudah punya akun?{" "}
          <Link href="/login" className="font-semibold text-green-700 hover:text-green-800">
            Masuk
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
          <Label htmlFor="businessName">Nama Usaha</Label>
          <Input
            id="businessName"
            required
            value={form.businessName}
            onChange={(e) => update("businessName", e.target.value)}
            placeholder="Toko Kopi Nusantara"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="name">Nama Anda</Label>
          <Input
            id="name"
            required
            value={form.name}
            onChange={(e) => update("name", e.target.value)}
            placeholder="Owner Toko Kopi"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            required
            value={form.email}
            onChange={(e) => update("email", e.target.value)}
            placeholder="kamu@usaha.id"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            required
            minLength={8}
            value={form.password}
            onChange={(e) => update("password", e.target.value)}
            placeholder="Minimal 8 karakter"
          />
        </div>
        <Button type="submit" disabled={loading} className="bg-green-600 hover:bg-green-700">
          {loading ? "Memproses…" : "Daftar"}
        </Button>
      </form>
    </AuthShell>
  );
}
