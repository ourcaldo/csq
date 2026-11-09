import { Cloud, PlugsConnected } from "@phosphor-icons/react";
import { Button } from "@csq/ui/components/ui/button";
import { AgentPicker } from "./agent-picker";
import { ConfigureCard } from "./configure-card";
import { Field, ReadOnlyField } from "./field";
import type { AgentItem, CloudForm } from "./types";

export function CloudApiForm(props: {
  form: CloudForm;
  onChange: (patch: Partial<CloudForm>) => void;
  agents: AgentItem[];
  agentId: string;
  onAgentChange: (v: string) => void;
  webhookUrl: string;
  cloudVerifyToken: string | null;
  connecting: boolean;
  isOwner: boolean;
  onBack: () => void;
  onSubmit: () => void;
}) {
  return (
    <ConfigureCard
      title="WhatsApp Resmi"
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
          hint="Token akses Meta Graph API, diawali EAAG..."
          disabled={!props.isOwner}
          type="password"
        />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field
            label="App Secret"
            value={props.form.appSecret}
            onChange={(v) => props.onChange({ appSecret: v })}
            hint="App Secret dari Meta App Manager"
            disabled={!props.isOwner}
            type="password"
          />
          <Field
            label="Business Account ID (opsional)"
            value={props.form.businessAccountId}
            onChange={(v) => props.onChange({ businessAccountId: v })}
            hint="Opsional. Contoh: 10xxxx..."
            disabled={!props.isOwner}
          />
        </div>

        {/* Webhook setup comes BEFORE Sambungkan: Meta must verify the
            callback, and the owner needs URL + token on screen while doing
            the Meta-side config. */}
        <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
          <p className="text-xs font-medium text-slate-600">
            Setel webhook di Meta App Manager (WhatsApp - Configuration) dengan
            nilai berikut, lalu klik Sambungkan dan tekan Verify di Meta:
          </p>
          <ReadOnlyField label="Callback URL" value={props.webhookUrl} />
          <ReadOnlyField
            label="Verify Token"
            value={props.cloudVerifyToken ?? "-"}
            hint="Token saat ini. Berganti otomatis setiap kali disambungkan ulang - salin nilai terbaru dari kartu saluran setelah Sambungkan."
          />
        </div>

        <AgentPicker
          agents={props.agents}
          value={props.agentId}
          onChange={props.onAgentChange}
          disabled={!props.isOwner}
        />

        <div className="pt-1">
          <Button disabled={!props.isOwner || props.connecting} onClick={props.onSubmit}>
            <PlugsConnected size={16} />
            {props.connecting ? "Menyambungkan..." : "Sambungkan"}
          </Button>
        </div>
      </div>
    </ConfigureCard>
  );
}
