import { useEffect, useState } from "react";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Picker for "what kind of data is this source?" — produk, cabang, staff, or a
// custom label. Only "produk" triggers the structured product import (mapping
// editor + Product/Inventory upsert); every other type is reference data the
// agent reads via source.search. The chosen value is stored as DataSource.dataType
// and surfaced to the agent in source.search results so it knows WHAT the data is.

const PRESETS = ["produk", "cabang", "staff", "lainnya"] as const;
const LABELS: Record<string, string> = {
  produk: "Produk",
  cabang: "Cabang / alamat",
  staff: "Staff / tim",
  lainnya: "Lainnya",
};

type Props = {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
};

export function DataTypeSelector({ value, onChange, disabled }: Props) {
  const isPreset = (PRESETS as readonly string[]).includes(value);
  const selectValue = isPreset ? value : "lainnya";
  const [custom, setCustom] = useState(!isPreset ? value : "");

  // Keep the custom field in sync if the parent resets value (e.g. dialog reopen).
  useEffect(() => {
    const preset = (PRESETS as readonly string[]).includes(value);
    setCustom(preset ? "" : value);
  }, [value]);

  function onSelectChange(v: string) {
    if (v === "lainnya") {
      onChange(custom.trim() || "");
    } else {
      onChange(v);
    }
  }

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 items-center gap-3">
        <div>
          <Label htmlFor="data-type">Tipe Data</Label>
          <p className="text-xs text-muted-foreground">Apa isi data ini?</p>
        </div>
        <Select
          id="data-type"
          value={selectValue}
          onChange={(e) => onSelectChange(e.target.value)}
          disabled={disabled}
        >
          {PRESETS.map((p) => (
            <option key={p} value={p}>
              {LABELS[p]}
            </option>
          ))}
        </Select>
      </div>
      {selectValue === "lainnya" && (
        <Input
          value={custom}
          onChange={(e) => {
            setCustom(e.target.value);
            onChange(e.target.value);
          }}
          placeholder="mis. daftar harga grosir"
          disabled={disabled}
        />
      )}
    </div>
  );
}
