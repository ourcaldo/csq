import { useState } from "react";
import { apiSend, ApiError } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

// Google Sheets step inside the Add Source dialog. The Google connection lives
// at the tenant level, so this shows either a Connect link (navigates to Google
// consent; returns to the page with ?sheets_source= and the parent opens the
// picker) or, when connected, a Disconnect button + "Tambah Spreadsheet" which
// creates a placeholder source and opens the picker WITHOUT re-login.

type Props = {
  connected: boolean;
  email?: string;
  onConnectionChanged: () => void;
  onOpenPicker: (sourceId: string) => void;
};

export function GoogleSheetsStep({ connected, email, onConnectionChanged, onOpenPicker }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      await apiSend("/api/dashboard/sources/google/disconnect", "POST");
      onConnectionChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal memutuskan akun.");
    } finally {
      setBusy(false);
    }
  }

  async function addSpreadsheet() {
    setBusy(true);
    setError(null);
    try {
      const res = await apiSend<{ id: string }>("/api/dashboard/sources/sheets/create", "POST");
      onOpenPicker(res.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menambah spreadsheet.");
    } finally {
      setBusy(false);
    }
  }

  if (!connected) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Sambungkan akun Google untuk memilih spreadsheet. Anda akan login ke Google, memilih akun,
          lalu menyetujui akses ke Google Sheets & Drive.
        </p>
        {/* An <a> rather than next/link: this is an API route that redirects
            off-site to Google consent — a native anchor is the correct choice. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a href="/api/import/sheets/auth">
          <Button disabled={busy}>Connect Google Account</Button>
        </a>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Badge variant="success">Terhubung</Badge>
        <span className="text-sm text-muted-foreground">{email ? `sebagai ${email}` : "akun Google"}</span>
      </div>
      <p className="text-sm text-muted-foreground">
        Tambah spreadsheet baru tanpa perlu login lagi — Anda cukup memilih dari daftar spreadsheet
        Anda.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={addSpreadsheet} disabled={busy}>
          {busy ? "Memproses…" : "Tambah Spreadsheet"}
        </Button>
        <Button variant="outline" onClick={disconnect} disabled={busy}>
          Disconnect Google Account
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
