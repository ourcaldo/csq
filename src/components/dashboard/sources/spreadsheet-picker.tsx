import { useEffect, useState } from "react";
import { apiFetch, apiSend, ApiError } from "@/lib/api-client";
import type { ColumnMapping } from "@/types/import";
import type { SpreadsheetRef } from "@/types/sheets";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { StateNotice } from "@/components/dashboard/state-notice";
import { MappingEditor } from "./mapping-editor";

// Spreadsheet picker for the Google Sheets flow. Uses the tenant's stored
// Google connection (no re-login). Bound to a placeholder GOOGLE_SHEETS
// DataSource (sourceId) created by the callback or by /sheets/create.
// Phases: pick spreadsheet → pick tab → mapping preview → confirm import.

type ConnectResponse = {
  headers: string[];
  preview: Record<string, unknown>[];
  mapping: ColumnMapping;
  confidence: number;
  rowCount: number;
};

type ConfirmResponse = { summary: { created: number; updated: number; errors: string[] } };

type Props = {
  sourceId: string;
  onClose: () => void;
  onDone: () => void;
};

export function SpreadsheetPicker({ sourceId, onClose, onDone }: Props) {
  const [phase, setPhase] = useState<"sheet" | "tab" | "preview">("sheet");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [spreadsheets, setSpreadsheets] = useState<SpreadsheetRef[]>([]);
  const [spreadsheetId, setSpreadsheetId] = useState("");
  const [tabs, setTabs] = useState<string[]>([]);
  const [tab, setTab] = useState("");
  const [connect, setConnect] = useState<ConnectResponse | null>(null);

  // Load the spreadsheet list on mount.
  useEffect(() => {
    let active = true;
    setBusy(true);
    apiFetch<SpreadsheetRef[]>("/api/dashboard/sources/spreadsheets")
      .then((r) => {
        if (active) setSpreadsheets(r);
      })
      .catch((err: unknown) => {
        if (active) setError(err instanceof ApiError ? err.message : "Gagal memuat spreadsheet.");
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function loadTabs(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<{ tabs: string[] }>(
        `/api/dashboard/sources/sheets/tabs?spreadsheetId=${encodeURIComponent(id)}`
      );
      setTabs(res.tabs);
      setTab(res.tabs[0] ?? "");
      setPhase("tab");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal memuat tab.");
    } finally {
      setBusy(false);
    }
  }

  async function doConnect() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<ConnectResponse>("/api/import/sheets/connect", "POST", {
        sourceId,
        spreadsheetId,
        sheetName: tab,
      });
      setConnect(res);
      setPhase("preview");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal membaca spreadsheet.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm(mapping: ColumnMapping) {
    setBusy(true);
    setError(null);
    try {
      await apiSend<ConfirmResponse>("/api/import/sheets/confirm", "POST", {
        sourceId,
        name: tab,
        mapping,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal mengimpor data.");
    } finally {
      setBusy(false);
    }
  }

  if (phase === "preview" && connect) {
    return (
      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium">{tab}</p>
          <p className="text-xs text-muted-foreground">
            {connect.rowCount} baris terdeteksi. Konfidensi: {Math.round(connect.confidence * 100)}%.
          </p>
        </div>
        <div className="rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                {connect.headers.map((h) => (
                  <th key={h} className="px-2 py-1 text-left font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {connect.preview.slice(0, 5).map((row, i) => (
                <tr key={i} className="border-t">
                  {connect.headers.map((h) => (
                    <td key={h} className="px-2 py-1">
                      {String(row[h] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <MappingEditor
          headers={connect.headers}
          initialMapping={connect.mapping}
          busy={busy}
          onConfirm={confirm}
          onCancel={() => setPhase("tab")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {phase === "sheet" && (
        <div className="space-y-3">
          <div>
            <Label htmlFor="pick-sheet">Pilih Spreadsheet</Label>
            <p className="text-xs text-muted-foreground">Daftar dari akun Google Anda.</p>
          </div>
          {spreadsheets.length === 0 && !busy && !error && (
            <StateNotice variant="empty" message="Tidak ada spreadsheet ditemukan di akun Anda." />
          )}
          <Select
            id="pick-sheet"
            value={spreadsheetId}
            onChange={(e) => setSpreadsheetId(e.target.value)}
            disabled={busy}
          >
            <option value="">— pilih spreadsheet —</option>
            {spreadsheets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Batal
            </Button>
            <Button
              disabled={busy || !spreadsheetId}
              onClick={() => loadTabs(spreadsheetId)}
            >
              {busy ? "Memuat…" : "Lanjut"}
            </Button>
          </div>
        </div>
      )}

      {phase === "tab" && (
        <div className="space-y-3">
          <div>
            <Label htmlFor="pick-tab">Pilih Tab</Label>
            <p className="text-xs text-muted-foreground">
              Spreadsheet: {spreadsheets.find((s) => s.id === spreadsheetId)?.name}
            </p>
          </div>
          <Select
            id="pick-tab"
            value={tab}
            onChange={(e) => setTab(e.target.value)}
            disabled={busy}
          >
            {tabs.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Select>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setPhase("sheet")} disabled={busy}>
              Kembali
            </Button>
            <Button disabled={busy || !tab} onClick={doConnect}>
              {busy ? "Memuat…" : "Lanjut"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
