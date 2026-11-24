// /ubah-password - forced-rotation page (audit run-3, admin.tenant-owner-
// takeover). A user flagged mustChangePassword (admin reset, tenant
// bootstrap) is redirected here by withAuth/getAuthSession and can do
// nothing else until a new password is set. On success the old session
// (and the emailed bootstrap credential) is dead - the user signs in again.
import { useState } from "react";
import type { FormEvent } from "react";
import type { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import { signOut, useSession } from "next-auth/react";
import { withAuth } from "@csq/core/lib/auth";
import { Seo } from "@csq/ui/components/seo";
import { apiSend } from "@/lib/api-client";

export default function ChangePasswordPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("Konfirmasi kata sandi tidak sama.");
      return;
    }
    setSaving(true);
    try {
      await apiSend("/api/dashboard/account/password", "PUT", {
        currentPassword,
        newPassword,
      });
      // The old JWT is revoked by the stamp bump - a clean re-login is part
      // of the flow, not an error.
      await signOut({ callbackUrl: "/login" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengubah kata sandi.");
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <Seo title="Ubah Kata Sandi" noindex />
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-600 text-white">
            <span className="text-sm font-bold">C</span>
          </div>
          <h1 className="mt-4 text-lg font-bold text-slate-900">Ubah Kata Sandi</h1>
          <p className="mt-1 text-sm text-slate-500">
            Kata sandi Anda diatur oleh admin platform dan wajib diganti sebelum
            melanjutkan{session?.user?.email ? ` (akun: ${session.user.email})` : ""}.
          </p>
        </div>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="current" className="block text-xs font-medium text-slate-700">
              Kata Sandi Saat Ini
            </label>
            <input
              id="current"
              type="password"
              required
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600/15"
            />
          </div>
          <div>
            <label htmlFor="new" className="block text-xs font-medium text-slate-700">
              Kata Sandi Baru
            </label>
            <input
              id="new"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600/15"
            />
            <p className="mt-1 text-[11px] text-slate-400">Minimal 8 karakter.</p>
          </div>
          <div>
            <label htmlFor="confirm" className="block text-xs font-medium text-slate-700">
              Konfirmasi Kata Sandi Baru
            </label>
            <input
              id="confirm"
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="mt-1.5 h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600/15"
            />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button
            type="submit"
            disabled={saving}
            className="w-full rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-60"
          >
            {saving ? "Menyimpan..." : "Simpan dan Masuk Kembali"}
          </button>
        </form>
      </div>
    </div>
  );
}

// Session-only guard (NOT withAuth): a mustChangePassword user must be able
// to reach this page; withAuth would redirect them back into the loop.
export const getServerSideProps: GetServerSideProps = withAuth(
  async () => ({ props: {} })
);
