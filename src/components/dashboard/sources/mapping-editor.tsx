import { useState } from "react";
import type { ColumnMapping } from "@/types/import";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

// Shared column-mapping editor for Excel and Google Sheets imports. The owner
// maps spreadsheet columns to product fields (name/price/quantity/sku/description),
// pre-filled from the auto-detected mapping. "(tidak dipetakan)" = null.
//
// Reused by both flows so the confirm payload matches columnMappingSchema /
// sheetsConfirmSchema.mapping exactly: { name, price, quantity, sku?, description? }
// with string | null values.

type FieldDef = {
  key: keyof ColumnMapping;
  label: string;
  hint?: string;
};

const FIELDS: FieldDef[] = [
  { key: "name", label: "Nama Produk", hint: "wajib agar produk terbentuk" },
  { key: "price", label: "Harga" },
  { key: "quantity", label: "Stok / Jumlah" },
  { key: "sku", label: "SKU (opsional)" },
  { key: "description", label: "Deskripsi (opsional)" },
];

type Props = {
  headers: string[];
  initialMapping: ColumnMapping;
  busy?: boolean;
  onConfirm: (mapping: ColumnMapping) => void;
  onCancel?: () => void;
};

export function MappingEditor({ headers, initialMapping, busy, onConfirm, onCancel }: Props) {
  const [mapping, setMapping] = useState<ColumnMapping>(initialMapping);

  function setField(key: keyof ColumnMapping, value: string) {
    setMapping((prev) => ({ ...prev, [key]: value || null }));
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Petakan kolom dari file ke field produk. Field yang tidak dipilih akan diabaikan.
      </p>
      <div className="space-y-3">
        {FIELDS.map((f) => (
          <div key={f.key} className="grid grid-cols-2 items-center gap-3">
            <div>
              <Label htmlFor={`map-${f.key}`}>{f.label}</Label>
              {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
            </div>
            <Select
              id={`map-${f.key}`}
              value={mapping[f.key] ?? ""}
              onChange={(e) => setField(f.key, e.target.value)}
              disabled={busy}
            >
              <option value="">(tidak dipetakan)</option>
              {headers.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </Select>
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2 pt-2">
        {onCancel && (
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Batal
          </Button>
        )}
        <Button onClick={() => onConfirm(mapping)} disabled={busy}>
          {busy ? "Memproses…" : "Konfirmasi & Impor"}
        </Button>
      </div>
    </div>
  );
}
