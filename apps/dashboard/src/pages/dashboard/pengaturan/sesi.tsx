// /dashboard/pengaturan/sesi - auto session close policy (reference section 4).
// Same API as the old AutoCloseSection; new presentation: status toggle row,
// window row with quick presets, save footer.
import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { GetServerSideProps } from "next";
import { withAuth } from "@csq/core/lib/auth";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { SettingsShell } from "@/components/dashboard/settings/settings-shell";
import { ReadOnlyBanner, useCanEdit } from "@/components/dashboard/settings/settings-access";
import { cn } from "@csq/ui/lib/utils";

type AutoCloseStatus = { enabled: boolean; idleMinutes: number };

export default function PengaturanSesiPage() {
  const canEdit = useCanEdit("pengaturan.kelola");
  const { data, loading, error, refresh } = useApi<AutoCloseStatus>(
    "/api/dashboard/settings/auto-close"
  );

  const [enabled, setEnabled] = useState(false);
  const [idleMinutes, setIdleMinutes] = useState("60");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!data) return;
    setEnabled(data.enabled);
    setIdleMinutes(String(data.idleMinutes));
  }, [data]);

  function onToggle(e: ChangeEvent<HTMLInputElement>) {
    setEnabled(e.target.checked);
    setSaved(false);
  }

  function applyPreset(mins: number) {
    setIdleMinutes(String(mins));
    setSaved(false);
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (saving) return;
    const minutes = Number(idleMinutes);
    if (!Number.isInteger(minutes) || minutes < 15 || minutes > 1440) {
      setFormError("Jendela waktu harus 15 sampai 1440 menit.");
      return;
    }
    setSaving(true);
    setFormError(null);
    setSaved(false);
    try {
      await apiSend("/api/dashboard/settings/auto-close", "PUT", {
        enabled,
        idleMinutes: minutes,
      });
      setSaved(true);
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal menyimpan pengaturan.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SettingsShell
      section="sesi"
      title="Kebijakan Penutupan Sesi Otomatis"
      description="Atur siklus hidup percakapan pelanggan untuk menjaga akurasi metrik SLA dan antrean agen."
    >
      <form onSubmit={save} className="divide-y divide-slate-200">
        {!canEdit && <ReadOnlyBanner />}
        {/* Status row */}
        <div className="grid grid-cols-1 gap-y-4 py-6 md:grid-cols-12 md:gap-x-8">
          <div className="md:col-span-4">
            <span className="text-xs font-semibold text-slate-900">Status Otomasi</span>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Hanya berlaku untuk percakapan yang balasan terakhirnya berasal dari agen.
            </p>
          </div>
          <div className="md:col-span-8">
            {loading && <p className="text-sm text-slate-500">Memuat pengaturan sesi...</p>}
            {error && <p className="text-sm text-red-600">{error}</p>}
            {!loading && !error && (
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  id="ac-toggle"
                  type="checkbox"
                  checked={enabled}
                  onChange={onToggle}
                  disabled={!canEdit}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-green-600 focus:ring-green-600"
                />
                <div className="text-xs">
                  <span className="font-semibold text-slate-900">
                    Aktifkan penutupan sesi otomatis saat pelanggan tidak merespons
                  </span>
                  <p className="mt-1 leading-relaxed text-slate-500">
                    Sistem akan mengirimkan pesan penutup standar dan menandai status chat menjadi{" "}
                    <strong>Selesai</strong>. Percakapan yang belum pernah dibalas oleh agen{" "}
                    <strong>tidak akan pernah</strong> ditutup otomatis. Percakapan tanpa pesan
                    masuk pelanggan lebih dari 24 jam ditutup tanpa mengirim pesan, dan pesan
                    penutup dikirim bertahap agar tidak terlihat seperti spam.
                  </p>
                </div>
              </label>
            )}
          </div>
        </div>

        {/* Window row */}
        <div className="grid grid-cols-1 gap-y-4 py-6 md:grid-cols-12 md:gap-x-8">
          <div className="md:col-span-4">
            <span className="text-xs font-semibold text-slate-900">Jendela Inaktivitas</span>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">
              Durasi tunggu sejak pesan terakhir agen terkirim (15-1.440 menit).
            </p>
          </div>
          <div className="md:col-span-8">
            {formError && <p className="mb-3 text-sm text-red-600">{formError}</p>}
            {saved && <p className="mb-3 text-sm font-medium text-green-700">Kebijakan penutupan sesi disimpan.</p>}
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="ac-minutes"
                type="number"
                min={15}
                max={1440}
                value={idleMinutes}
                onChange={(e) => setIdleMinutes(e.target.value)}
                disabled={!enabled || !canEdit}
                className="h-9 w-28 rounded-md border border-slate-300 bg-white px-3 font-mono text-sm disabled:bg-slate-50 disabled:text-slate-400 focus:border-green-600 focus:outline-none focus:ring-2 focus:ring-green-600/15"
              />
              <span className="text-xs text-slate-500">menit</span>
              <div className="ml-2 flex gap-1">
                {[30, 60, 240, 1440].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => applyPreset(m)}
                    disabled={!enabled || !canEdit}
                    className={cn(
                      "rounded border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40",
                      idleMinutes === String(m) && "border-green-300 bg-green-50 text-green-700"
                    )}
                  >
                    {m === 1440 ? "24 jam" : m === 240 ? "4 jam" : m === 60 ? "1 jam" : "30m"}
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Jika pelanggan kembali mengirim pesan setelah sesi ditutup, percakapan akan otomatis dibuka kembali.
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end pt-5">
          <button
            type="submit"
            disabled={saving || !canEdit}
            className="rounded-md bg-green-600 px-4 py-2 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
          >
            {saving ? "Menyimpan..." : "Simpan Kebijakan"}
          </button>
        </div>
      </form>
    </SettingsShell>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth(
  async () => ({ props: {} })
);
