import { AdminShell } from "@/components/admin-shell";
import { withAdminAuth } from "@/lib/admin-auth";
import { Card } from "@csq/ui/components/ui/card";
import { Badge } from "@csq/ui/components/ui/badge";

// Ringkasan (Overview, PRD 13 menu 1) - Phase 1 ships the shell; the KPI
// data lands with the tenants/operations phases.
export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

export default function AdminOverview() {
  return (
    <AdminShell title="Ringkasan">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold text-slate-900">Ringkasan Platform</h2>
          <Badge variant="outline">Phase 1 - skeleton</Badge>
        </div>
        <Card className="p-6">
          <p className="text-sm text-slate-500">
            KPI platform (tenant, pesan, saluran, outbox, tick) menyusul pada
            fase berikutnya. Kerangka konsol, realm auth, dan shell navigasi
            sudah aktif.
          </p>
        </Card>
      </div>
    </AdminShell>
  );
}
