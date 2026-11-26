// Owner decision 2026-11-26: every settings page is readable by every member
// of the tenant; only CHANGES require the page's write permission. These
// helpers give the pages one consistent read-only mode.
import { useSession } from "next-auth/react";

// True when the signed-in user may WRITE this settings section. Owner passes
// everything; members need the permission in their role (owner-only keys like
// pengaturan.kelola are never grantable, so those sections stay owner-write).
export function useCanEdit(permission: string): boolean {
  const { data: session } = useSession();
  return (
    !!session?.user?.isOwner ||
    !!session?.user?.permissions?.includes(permission)
  );
}

// Banner shown on a settings page in read-only mode.
export function ReadOnlyBanner() {
  return (
    <p className="mb-4 rounded-md border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs leading-relaxed text-slate-600">
      Mode lihat: Anda dapat melihat pengaturan ini, tetapi hanya pemilik atau
      peran dengan izin yang sesuai yang dapat menyimpan perubahan.
    </p>
  );
}
