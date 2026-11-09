import { Cloud, PlugsConnected } from "@phosphor-icons/react";
import { Button } from "@csq/ui/components/ui/button";
import { ConfigureCard } from "./configure-card";
import { Field } from "./field";
import type { CloudForm } from "./types";

export function CloudApiEditForm(props: {
  form: CloudForm;
  onChange: (patch: Partial<CloudForm>) => void;
  connecting: boolean;
  isOwner: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  return (
    <ConfigureCard
      title="Edit Kredensial"
      icon={<Cloud size={20} weight="fill" />}
      onBack={props.onBack}
    >
      <div className="space-y-3">
        <Field
          label="Phone Number ID"
          value={props.form.phoneNumberId}
          onChange={(v) => props.onChange({ phoneNumberId: v })}
          hint="Contoh: 103xxxxxxxxxx"
          disabled={!props.isOwner}
        />
        <Field
          label="Access Token"
          value={props.form.token}
          onChange={(v) => props.onChange({ token: v })}
          hint="Masukkan ulang token akses Meta Graph API"
          disabled={!props.isOwner}
          type="password"
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="App Secret"
            value={props.form.appSecret}
            onChange={(v) => props.onChange({ appSecret: v })}
            hint="Masukkan ulang App Secret dari Meta App Manager"
            disabled={!props.isOwner}
            type="password"
          />
        </div>
        <div className="flex items-center gap-2 pt-1">
          <Button disabled={!props.isOwner || props.connecting} onClick={props.onSubmit}>
            <PlugsConnected size={16} />
            {props.connecting ? "Menyimpan..." : "Simpan"}
          </Button>
          <Button variant="outline" onClick={props.onBack} disabled={props.connecting}>
            Batal
          </Button>
        </div>
        <p className="text-xs text-slate-400">
          Menyimpan membuat verify token baru - perbarui token webhook di Meta
          App Manager setelahnya.
        </p>
      </div>
    </ConfigureCard>
  );
}
