import { AdminShell } from "@/components/admin-shell";
import { withAdminAuth } from "@/lib/admin-auth";
import { Card } from "@csq/ui/components/ui/card";

// Saluran (PRD 13) - placeholder; the data lands with its phase.
export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

export default function ChannelsPage() {
  return (
    <AdminShell title="Saluran">
      <div className="mx-auto max-w-6xl space-y-6">
        <h2 className="text-lg font-semibold text-slate-900">Saluran</h2>
        <Card className="p-6">
          <p className="text-sm text-slate-500">Menyusul pada fase berikutnya.</p>
        </Card>
      </div>
    </AdminShell>
  );
}
