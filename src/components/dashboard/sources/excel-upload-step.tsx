import { useRef, useState } from "react";
import { apiSend } from "@/lib/api-client";
import { ApiError } from "@/lib/api-client";
import type { ColumnMapping } from "@/types/import";
import { Button } from "@/components/ui/button";
import { MappingEditor } from "./mapping-editor";

// Excel/CSV upload flow inside the Add Source dialog:
// pick file → POST /api/import/excel (parse + detected mapping) → MappingEditor
// → POST /api/import/excel/confirm { filename, base64, mapping } → done.
// The file is sent as base64 JSON (no multipart) per the existing route contract.

type PreviewResponse = {
  headers: string[];
  mapping: ColumnMapping;
  confidence: number;
  fieldConfidence: Record<string, number>;
  previewRows: Record<string, unknown>[];
};

type ConfirmResponse = { imported: number; dataSourceId: string };

type Props = {
  onDone: () => void;
};

export function ExcelUploadStep({ onDone }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<"pick" | "preview">("pick");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState("");
  const [base64, setBase64] = useState("");
  const [preview, setPreview] = useState<PreviewResponse | null>(null);

  function onFile(file: File) {
    setError(null);
    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      // readAsDataURL → "data:<mime>;base64,<payload>"; take the payload after the comma.
      const result = reader.result;
      if (typeof result !== "string") {
        setError("Gagal membaca file.");
        return;
      }
      const payload = result.includes(",") ? result.split(",")[1] : result;
      setBase64(payload);
      void upload(file.name, payload);
    };
    reader.onerror = () => setError("Gagal membaca file.");
    reader.readAsDataURL(file);
  }

  async function upload(name: string, data: string) {
    setBusy(true);
    try {
      const res = await apiSend<PreviewResponse>("/api/import/excel", "POST", {
        filename: name,
        base64: data,
      });
      setPreview(res);
      setPhase("preview");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal mengunggah file.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm(mapping: ColumnMapping) {
    setBusy(true);
    setError(null);
    try {
      await apiSend<ConfirmResponse>("/api/import/excel/confirm", "POST", {
        filename,
        base64,
        mapping,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal mengimpor data.");
    } finally {
      setBusy(false);
    }
  }

  if (phase === "preview" && preview) {
    return (
      <div className="space-y-4">
        <div>
          <p className="text-sm font-medium">{filename}</p>
          <p className="text-xs text-muted-foreground">
            {preview.previewRows.length} baris pertama ditampilkan. Konfidensi deteksi:{" "}
            {Math.round(preview.confidence * 100)}%.
          </p>
        </div>
        <div className="rounded-md border">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                {preview.headers.map((h) => (
                  <th key={h} className="px-2 py-1 text-left font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.previewRows.map((row, i) => (
                <tr key={i} className="border-t">
                  {preview.headers.map((h) => (
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
          headers={preview.headers}
          initialMapping={preview.mapping}
          busy={busy}
          onConfirm={confirm}
          onCancel={() => setPhase("pick")}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Unggah file Excel (.xlsx) atau CSV berisi daftar produk. Setelah diunggah, Anda memetakan
        kolom ke field produk sebelum diimpor.
      </p>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
      <Button
        variant="outline"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
      >
        {busy ? "Memproses…" : "Pilih File Excel/CSV"}
      </Button>
      {filename && <p className="text-xs text-muted-foreground">File: {filename}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
