// Auto session close section of the Settings page (OWNER-only - the parent
// guards rendering). Per-tenant toggle + idle window: when enabled, the
// worker sends the session_end goodbye, marks the session closed, and
// RESOLVES conversations whose last message is the agent's reply and whose
// customer has been silent for the window. An unanswered customer message
// never auto-closes (PRD 03 amendment 2026-11-11).
import { useEffect, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { Timer, CheckCircle, WarningCircle } from "@phosphor-icons/react";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { StateNotice } from "@/components/dashboard/state-notice";
import { BadgeStatus } from "@/components/dashboard/badge-status";
import { Button } from "@csq/ui/components/ui/button";
import { Input } from "@csq/ui/components/ui/input";
import { Label } from "@csq/ui/components/ui/label";
import { Separator } from "@csq/ui/components/ui/separator";

type AutoCloseStatus = {
  enabled: boolean;
  idleMinutes: number;
};

export function AutoCloseSection() {
  const { data, loading, error, refresh } = useApi<AutoCloseStatus>(
    "/api/dashboard/settings/auto-close"
  );

  const [enabled, setEnabled] = useState(false);
  const [idleMinutes, setIdleMinutes] = useState("60");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Hydrate the form from the saved config once it loads (and on refresh).
  useEffect(() => {
    if (!data) return;
    setEnabled(data.enabled);
    setIdleMinutes(String(data.idleMinutes));
  }, [data]);

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
    <div>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600">
            <Timer size={18} />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900">Penutupan Sesi Otomatis</p>
            <p className="text-sm text-slate-500">
              Chat ditutup otomatis bila pelanggan tidak membalas balasan agen dalam jendela
              waktu di bawah ini.
            </p>
          </div>
        </div>
        <BadgeStatus tone={data?.enabled ? "green" : "neutral"}>
          {data?.enabled ? "Aktif" : "Nonaktif"}
        </BadgeStatus>
      </div>

      <Separator className="my-4" />

      {loading && <StateNotice variant="loading" message="Memuat pengaturan sesi..." />}
      {error && <StateNotice variant="error" message={error} />}
      {formError && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <WarningCircle size={18} className="mt-0.5 shrink-0" />
          <span>{formError}</span>
        </div>
      )}
      {saved && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-green-600/40 bg-green-600/10 p-3 text-sm text-green-700">
          <CheckCircle size={18} className="mt-0.5 shrink-0" />
          <span>Pengaturan tersimpan.</span>
        </div>
      )}

      {!loading && (
        <form onSubmit={save} className="max-w-xl space-y-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setEnabled(e.target.checked)}
              className="mt-1 h-4 w-4"
            />
            <span>
              <span className="block text-sm font-medium text-slate-700">
                Tutup sesi otomatis
              </span>
              <span className="block text-xs text-slate-500">
                Saat aktif: balasan agen tidak dijawab pelanggan selama jendela waktu akan
                dikirim pesan penutup, sesi ditandai selesai, dan status chat menjadi
                Selesai. Chat pelanggan yang belum dijawab agen TIDAK pernah ditutup
                otomatis.
              </span>
            </span>
          </label>

          <div>
            <Label htmlFor="idle-minutes">Jendela waktu (menit)</Label>
            <Input
              id="idle-minutes"
              type="number"
              min={15}
              max={1440}
              value={idleMinutes}
              onChange={(e) => setIdleMinutes(e.target.value)}
              disabled={!enabled}
              placeholder="60"
            />
            <p className="mt-1 text-xs text-slate-500">
              15 sampai 1440 menit. Default 60 menit. Pesan pelanggan berikutnya membuka
              kembali chat secara otomatis.
            </p>
          </div>

          <div>
            <Button type="submit" disabled={saving}>
              {saving ? "Menyimpan..." : "Simpan Pengaturan"}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
