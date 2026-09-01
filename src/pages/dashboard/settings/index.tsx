// Settings page — source-priority reorder (OWNER-only edits) + read-only
// business-profile placeholder. Staff see the current priority order but the
// reorder controls and Save button are hidden (the PUT route is OWNER-only
// server-side anyway, so this is a UX guard, not the security boundary).
import { useEffect, useState } from "react";
import type { GetServerSideProps } from "next";
import { useSession } from "next-auth/react";
import {
  Gear,
  ArrowsClockwise,
  ArrowUp,
  ArrowDown,
  FloppyDisk,
  Storefront,
  CheckCircle,
  WarningCircle,
  PlugsConnected,
} from "@phosphor-icons/react";
import { withAuth } from "@/lib/auth";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { EmailSection } from "@/components/dashboard/settings/email-section";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { StateNotice } from "@/components/dashboard/state-notice";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

// The backend enum is z.enum(["MANUAL","EXCEL","GOOGLE_SHEETS"]). We mirror the
// allowed values locally and keep the wire type as string[] to match the route
// response shape ({ sourcePriority: string[] }).
type SourceType = "MANUAL" | "EXCEL" | "GOOGLE_SHEETS";

const TYPE_LABEL: Record<SourceType, string> = {
  MANUAL: "Manual",
  EXCEL: "Excel",
  GOOGLE_SHEETS: "Google Sheets",
};

const TYPE_DESCRIPTION: Record<SourceType, string> = {
  MANUAL: "Entri data yang diketik langsung di dashboard.",
  EXCEL: "File Excel/CSV yang diunggah dan diparse.",
  GOOGLE_SHEETS: "Google Sheets yang disinkronkan via OAuth.",
};

type PriorityResult = { sourcePriority: string[] };

type TenantInfo = {
  id: string;
  name: string;
  slug: string;
  cellStatus: string | null;
  openclawCellId: string | null;
};

function cellStatusLabel(status: string | null): string {
  if (status === "PROVISIONED") return "Aktif";
  if (status === "PENDING") return "Membuat…";
  if (status === "FAILED") return "Gagal";
  return "Menunggu";
}

function isSourceType(value: string): value is SourceType {
  return value === "MANUAL" || value === "EXCEL" || value === "GOOGLE_SHEETS";
}

export default function SettingsPage() {
  const { data: session } = useSession();
  const isOwner = session?.user?.role === "OWNER";

  const { data, loading, error, refresh } = useApi<PriorityResult>(
    "/api/dashboard/sources/priority"
  );

  // Tenant / OpenClaw cell status (PRD §5/§26).
  const { data: tenantInfo, refresh: refreshTenant } =
    useApi<TenantInfo>("/api/dashboard/tenant");
  const [reprovisioning, setReprovisioning] = useState(false);
  const [reprovisionError, setReprovisionError] = useState<string | null>(null);

  async function onReprovision() {
    setReprovisioning(true);
    setReprovisionError(null);
    try {
      await apiSend("/api/dashboard/tenant/reprovision", "POST");
      refreshTenant();
    } catch (err) {
      setReprovisionError(err instanceof Error ? err.message : "Gagal memprovisi ulang.");
    } finally {
      setReprovisioning(false);
    }
  }

  // Local working copy of the order. Initialized from the GET; tracked with a
  // dirty flag so the Save button only enables when the order actually changed.
  const [order, setOrder] = useState<SourceType[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Hydrate local state once the fetch resolves (and on refresh). The effect
  // resets dirty/saved so a reloaded order is treated as the committed baseline.
  useEffect(() => {
    if (data) {
      const next: SourceType[] = [];
      for (const v of data.sourcePriority) {
        if (isSourceType(v)) next.push(v);
      }
      setOrder(next);
      setDirty(false);
      setSaved(false);
    }
  }, [data]);

  function moveUp(index: number) {
    if (index <= 0) return;
    setOrder((prev) => {
      const next = prev.slice();
      const tmp = next[index - 1];
      next[index - 1] = next[index];
      next[index] = tmp;
      return next;
    });
    setDirty(true);
    setSaved(false);
  }

  function moveDown(index: number) {
    setOrder((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = prev.slice();
      const tmp = next[index + 1];
      next[index + 1] = next[index];
      next[index] = tmp;
      return next;
    });
    setDirty(true);
    setSaved(false);
  }

  async function onSave() {
    if (!dirty || order.length === 0) return;
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      await apiSend<PriorityResult>(
        "/api/dashboard/sources/priority",
        "PUT",
        { sourcePriority: order }
      );
      setDirty(false);
      setSaved(true);
      refresh();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Gagal menyimpan prioritas.");
    } finally {
      setSaving(false);
    }
  }

  const tenantName = session?.user?.name ?? "Usaha Anda";

  return (
    <DashboardShell
      title="Pengaturan"
      description="Atur prioritas sumber data dan informasi usaha."
    >
      <div className="mx-auto max-w-3xl space-y-6">
        {/* Prioritas Sumber Data */}
        <section className="rounded-lg border border-slate-200 bg-white p-4 md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
                <ArrowsClockwise size={20} />
              </span>
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Prioritas Sumber Data
                </h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  Urutan sumber yang dipakai agent saat mencari data bisnis.
                  Sumber paling atas dipakai lebih dulu.
                </p>
              </div>
            </div>
          </div>

          <Separator className="my-4" />

          {!isOwner && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700">
              <WarningCircle size={18} className="mt-0.5 shrink-0" />
              <span>Hanya owner yang dapat mengubah urutan prioritas.</span>
            </div>
          )}

          {loading && (
            <StateNotice variant="loading" message="Memuat prioritas sumber…" />
          )}
          {error && <StateNotice variant="error" message={error} />}
          {saveError && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <WarningCircle size={18} className="mt-0.5 shrink-0" />
              <span>{saveError}</span>
            </div>
          )}
          {saved && (
            <div className="mb-4 flex items-start gap-2 rounded-md border border-green-600/40 bg-green-600/10 p-3 text-sm text-green-700">
              <CheckCircle size={18} className="mt-0.5 shrink-0" />
              <span>Prioritas sumber data berhasil disimpan.</span>
            </div>
          )}

          {!loading && !error && order.length > 0 && (
            <ol className="space-y-2">
              {order.map((type, i) => (
                <li
                  key={type}
                  className="flex items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-3"
                >
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-semibold text-slate-700">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{TYPE_LABEL[type]}</Badge>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {TYPE_DESCRIPTION[type]}
                    </p>
                  </div>
                  {isOwner && (
                    <div className="flex shrink-0 gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        disabled={i === 0}
                        onClick={() => moveUp(i)}
                        aria-label={`Naikkan ${TYPE_LABEL[type]}`}
                      >
                        <ArrowUp size={16} />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-8 w-8"
                        disabled={i === order.length - 1}
                        onClick={() => moveDown(i)}
                        aria-label={`Turunkan ${TYPE_LABEL[type]}`}
                      >
                        <ArrowDown size={16} />
                      </Button>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          )}

          {isOwner && !loading && !error && order.length > 0 && (
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={!dirty || saving}
                onClick={refresh}
              >
                <ArrowsClockwise size={16} />
                Batal
              </Button>
              <Button type="button" disabled={!dirty || saving} onClick={onSave}>
                <FloppyDisk size={16} />
                {saving ? "Menyimpan…" : "Simpan Urutan"}
              </Button>
            </div>
          )}
        </section>

        {/* Email — per-tenant delivery config (OWNER-only; the route is
            OWNER-only server-side too, so staff never even fetch it). */}
        {isOwner && <EmailSection />}

        {/* Profil Usaha — placeholder, read-only */}
        <section className="rounded-lg border border-slate-200 bg-white p-4 md:p-6">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
              <Storefront size={20} />
            </span>
            <div>
              <h2 className="text-base font-semibold text-slate-900">Profil Usaha</h2>
              <p className="mt-0.5 text-sm text-slate-500">
                Informasi dasar usaha Anda. Pengelolaan profil penuh akan hadir
                kemudian.
              </p>
            </div>
          </div>

          <Separator className="my-4" />

          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Nama Usaha
              </dt>
              <dd className="mt-1 text-sm text-slate-900">{tenantName}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Kontak Pemilik
              </dt>
              <dd className="mt-1 text-sm text-slate-900">
                {session?.user?.email ?? "—"}
              </dd>
            </div>
          </dl>

          <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-400">
            <Gear size={14} />
            Pengaturan tambahan akan ditambahkan di iterasi berikutnya.
          </p>
        </section>

        {/* Seluran OpenClaw — cell status (PRD §5/§26) */}
        <section className="rounded-lg border border-slate-200 bg-white p-4 md:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-green-100 text-green-700">
                <PlugsConnected size={20} />
              </span>
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  Seluran OpenClaw
                </h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  Runtime agent AI terisolasi untuk usaha ini. Satu sel per
                  usaha — tidak berbagi dengan usaha lain.
                </p>
              </div>
            </div>
            <Badge
              variant={
                tenantInfo?.cellStatus === "PROVISIONED"
                  ? "success"
                  : tenantInfo?.cellStatus === "FAILED"
                  ? "destructive"
                  : "secondary"
              }
            >
              {cellStatusLabel(tenantInfo?.cellStatus ?? null)}
            </Badge>
          </div>

          <Separator className="my-4" />

          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Cell ID
              </dt>
              <dd className="mt-1 break-all text-sm text-slate-900">
                {tenantInfo?.openclawCellId ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
                Slug
              </dt>
              <dd className="mt-1 text-sm text-slate-900">
                {tenantInfo?.slug ?? "—"}
              </dd>
            </div>
          </dl>

          {reprovisionError && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              <WarningCircle size={18} className="mt-0.5 shrink-0" />
              <span>{reprovisionError}</span>
            </div>
          )}

          {isOwner && (
            <div className="mt-4 flex justify-end">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={reprovisioning}
                onClick={onReprovision}
              >
                <ArrowsClockwise size={16} />
                {reprovisioning ? "Memprovisi…" : "Provisi Ulang"}
              </Button>
            </div>
          )}
        </section>
      </div>
    </DashboardShell>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth<Record<string, unknown>>(
  async () => ({ props: {} })
);
