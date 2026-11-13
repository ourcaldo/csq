import { useState } from "react";
import { AdminShell } from "@/components/admin-shell";
import { Btn, Empty, PageHead, Status, TableCard } from "@/components/console";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";

// API keys (PRD 13 Phase 4). Console copy is English (owner direction
// 2026-11-13).

type ApiKey = {
  id: string;
  name: string;
  prefix: string;
  tenantName: string;
  tenantSlug: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};
type KeyList = { items: ApiKey[] };

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

export default function ApiKeysPage() {
  const { data, loading, error, refresh } = useAdminApi<KeyList>("/api/admin/api-keys");
  const [busy, setBusy] = useState<string | null>(null);
  const items = data?.items ?? [];
  const active = items.filter((k) => !k.revokedAt).length;

  async function revoke(id: string) {
    setBusy(id);
    try {
      await adminFetch(`/api/admin/api-keys?id=${id}`, "DELETE");
      refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <AdminShell title="API Keys">
      <PageHead
        eyebrow="Configuration"
        title="API Keys"
        sub="Tenant tokens & integrations"
        action={
          <div className="flex gap-5 font-mono text-[12px]">
            <span>{active} active</span>
            <span className="text-muted-foreground">{items.length - active} revoked</span>
          </div>
        }
      />

      {error && (
        <div className="mb-4 rounded-xl border border-border border-l-2 border-l-bad bg-card px-5 py-3 text-[13px] text-bad">
          {error}
        </div>
      )}

      {!loading && items.length === 0 ? (
        <Empty
          title="No API keys yet"
          hint="Tenants mint keys from their own dashboard."
        />
      ) : (
        <TableCard>
          <table className="ledger">
            <thead>
              <tr>
                <th>Name</th>
                <th>Prefix</th>
                <th>Tenant</th>
                <th>Last used</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((k) => (
                <tr key={k.id}>
                  <td className="font-medium">{k.name}</td>
                  <td className="font-mono text-[12px] text-muted-foreground">{k.prefix}...</td>
                  <td>
                    <div className="text-[13.5px]">{k.tenantName}</div>
                    <div className="text-[12px] text-muted-foreground">{k.tenantSlug}</div>
                  </td>
                  <td className="whitespace-nowrap font-mono text-[12px] text-muted-foreground">
                    {k.lastUsedAt
                      ? new Date(k.lastUsedAt).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })
                      : "Never"}
                  </td>
                  <td>
                    <Status tone={k.revokedAt ? "off" : "ok"}>
                      {k.revokedAt ? "Revoked" : "Active"}
                    </Status>
                  </td>
                  <td className="text-right">
                    {!k.revokedAt && (
                      <Btn
                        variant="ghost"
                        disabled={busy === k.id}
                        onClick={() => void revoke(k.id)}
                        className="hover:text-bad"
                      >
                        Revoke
                      </Btn>
                    )}
                  </td>
                </tr>
              ))}
              {loading && (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-[13px] text-muted-foreground">
                    Loading...
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </TableCard>
      )}
    </AdminShell>
  );
}
