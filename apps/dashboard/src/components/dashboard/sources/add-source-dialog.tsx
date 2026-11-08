import { useState } from "react";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ExcelUploadStep } from "./excel-upload-step";
import { GoogleSheetsStep } from "./google-sheets-step";

// Entry dialog for adding a data source. Two choices: Excel/CSV upload (fully
// in-dialog) or Google Sheets (connect/disconnect + add spreadsheet). The
// Google OAuth path navigates off-site, so after consent the page reloads and
// the parent opens the SpreadsheetPicker directly (not via this dialog).

type Props = {
  open: boolean;
  onClose: () => void;
  googleConnected: boolean;
  googleEmail?: string;
  onConnectionChanged: () => void;
  onOpenPicker: (sourceId: string) => void;
  onImported: () => void;
};

export function AddSourceDialog({
  open,
  onClose,
  googleConnected,
  googleEmail,
  onConnectionChanged,
  onOpenPicker,
  onImported,
}: Props) {
  const [view, setView] = useState<"choice" | "excel" | "google">("choice");

  function close() {
    setView("choice");
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Tambah Sumber Data"
      description="Unggah file Excel/CSV atau sambungkan Google Sheets."
      className="max-w-xl"
    >
      {view === "choice" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            className="rounded-lg border p-4 text-left transition-colors hover:bg-muted/50"
            onClick={() => setView("excel")}
          >
            <p className="font-medium">Excel / CSV</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Unggah file dari komputer, petakan kolom, lalu impor.
            </p>
          </button>
          <button
            className="rounded-lg border p-4 text-left transition-colors hover:bg-muted/50"
            onClick={() => setView("google")}
          >
            <p className="font-medium">Google Sheets</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Login ke Google, pilih spreadsheet, lalu impor.
            </p>
          </button>
        </div>
      )}

      {view === "excel" && (
        <div className="space-y-3">
          <Button variant="ghost" size="sm" onClick={() => setView("choice")}>
            ← Kembali
          </Button>
          <ExcelUploadStep onDone={() => { onImported(); close(); }} />
        </div>
      )}

      {view === "google" && (
        <div className="space-y-3">
          <Button variant="ghost" size="sm" onClick={() => setView("choice")}>
            ← Kembali
          </Button>
          <GoogleSheetsStep
            connected={googleConnected}
            email={googleEmail}
            onConnectionChanged={onConnectionChanged}
            onOpenPicker={(id) => { onOpenPicker(id); close(); }}
          />
        </div>
      )}
    </Dialog>
  );
}
