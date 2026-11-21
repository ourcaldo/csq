// /dashboard/pengaturan/audit - configuration audit log (reference section 6).
// Reads the tenant's real AuditLog rows (settings-scoped actions) - the
// immutable trail the platform already writes on every mutation.
import { useEffect, useState } from "react";
import type { GetServerSideProps } from "next";
import { DownloadSimple } from "@phosphor-icons/react";
import { withAuth } from "@csq/core/lib/auth";
import { apiFetch } from "@/lib/api-client";
import { SettingsShell } from "@/components/dashboard/settings/settings-shell";

type AuditRow = {
  id: string;
  action: string;
  actorName: string | null;
  createdAt: string;
  entityType: string;
  entityId: string;
};

function fmt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return (
    d.toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" }) +
    ", " +
    d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })
  );
}

export default function PengaturanAuditPage() {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void apiFetch<{ items: AuditRow[] }>(
      "/api/dashboard/audit?pageSize=100"
    )
      .then((data) => {
        if (!cancelled) setRows(data.items);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Gagal memuat log audit.");
          setRows([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function exportCsv() {
    const list = rows ?? [];
    const header = "Waktu,Aktor,Peristiwa,Entitas";
    const lines = list.map((r) => {
      const cells = [
        fmt(r.createdAt),
        r.actorName ?? "Sistem",
        r.action,
        `${r.entityType} (${r.entityId})`,
      ];
      return cells.map((c) => `"${c}"`).join(",");
    });
    const blob = new Blob([[header, ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <SettingsShell
      section="audit"
      title="Log Audit Pengaturan"
      description="Jejak perubahan konfigurasi workspace yang tidak dapat diubah untuk keperluan kepatuhan dan keamanan internal."
      headerExtra={
        <button
          type="button"
          onClick={exportCsv}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
        >
          <DownloadSimple size={14} />
          Ekspor CSV
        </button>
      }
    >
      <div className="mt-5 overflow-x-auto">
        {error && <p className="mb-4 text-sm text-red-600">{error}</p>}
        {rows === null && !error && <p className="text-sm text-slate-500">Memuat log audit...</p>}
        {rows !== null && (
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                <th className="pb-2.5 pr-4">Waktu (WIB)</th>
                <th className="px-4 pb-2.5">Aktor</th>
                <th className="px-4 pb-2.5">Peristiwa</th>
                <th className="pb-2.5 pl-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 border-b border-slate-200">
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-slate-400">
                    Belum ada aktivitas konfigurasi tercatat.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/80">
                  <td className="whitespace-nowrap py-3 pr-4 font-mono text-slate-500">{fmt(r.createdAt)}</td>
                  <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-800">
                    {r.actorName ?? "Sistem"}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{r.action}</td>
                  <td className="whitespace-nowrap py-3 pl-4 text-right font-mono text-slate-400">
                    {r.entityType}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </SettingsShell>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth<Record<string, never>>(
  async () => ({ props: {} }),
  { requiredRole: "OWNER" }
);

