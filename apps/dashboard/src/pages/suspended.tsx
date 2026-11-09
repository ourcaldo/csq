import { signOut } from "next-auth/react";
import { Button } from "@csq/ui/components/ui/button";
import { AuthShell } from "@/components/auth/auth-shell";

// SEC-4 (PRD 16): the suspended-tenant landing page. Every dashboard page
// redirects here while the tenant is SUSPENDED; inbound WhatsApp keeps being
// ingested (data is never lost), the agent simply does not answer.
export default function SuspendedPage() {
  return (
    <AuthShell
      title="Akun Dinonaktifkan"
      subtitle="Akses dashboard dinonaktifkan sementara."
    >
      <div className="flex flex-col gap-4">
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Tenant Anda sedang dinonaktifkan oleh operator platform. Pesan pelanggan
          tetap kami simpan dan tidak hilang, tetapi agent tidak membalas selama
          masa ini. Silakan hubungi operator CSQ untuk aktivasi kembali.
        </p>
        <Button
          variant="outline"
          onClick={() => {
            void signOut({ callbackUrl: "/login" });
          }}
        >
          Keluar
        </Button>
      </div>
    </AuthShell>
  );
}
