import { Plug, QrCode, WhatsappLogo } from "@phosphor-icons/react";
import { QRCodeSVG } from "qrcode.react";
import { Button } from "@csq/ui/components/ui/button";
import { Switch } from "@csq/ui/components/ui/switch";
import { AgentPicker } from "./agent-picker";
import { ConfigureCard } from "./configure-card";
import type { AgentItem } from "./types";

export function BaileysForm(props: {
  agents: AgentItem[];
  agentId: string;
  onAgentChange: (v: string) => void;
  tos: boolean;
  onTosChange: (v: boolean) => void;
  connecting: boolean;
  isOwner: boolean;
  qr: string | null;
  qrStale: boolean;
  onBack: () => void;
  onConnect: () => void;
}) {
  return (
    <ConfigureCard
      title="Bawa Nomor Sendiri"
      icon={<WhatsappLogo size={20} weight="fill" />}
      onBack={props.onBack}
    >
      <div className="space-y-4">
        <AgentPicker
          agents={props.agents}
          value={props.agentId}
          onChange={props.onAgentChange}
          disabled={!props.isOwner}
        />

        <label className="flex items-center gap-2 text-sm text-slate-700">
          <Switch checked={props.tos} disabled={!props.isOwner} onChange={props.onTosChange} />
          Saya menyetujui ketentuan layanan untuk penggunaan nomor pribadi.
        </label>

        <div className="flex items-center gap-2">
          <Button
            disabled={!props.isOwner || !props.tos || props.connecting}
            onClick={props.onConnect}
          >
            <Plug size={16} />
            {props.connecting ? "Memulai..." : "Tampilkan QR"}
          </Button>
        </div>

        {props.qr && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="rounded-lg bg-white p-3 shadow-sm">
              <QRCodeSVG value={props.qr} size={200} level="M" />
            </div>
            <p className="flex items-center gap-1.5 text-sm text-slate-600">
              <QrCode size={16} />
              Buka WhatsApp &gt; Tautkan perangkat, lalu pindai QR ini. Status
              diperbarui otomatis.
            </p>
            {props.qrStale && (
              <div className="mt-1 flex flex-col items-center gap-2">
                <p className="text-center text-xs text-amber-700">
                  Scan belum terdeteksi setelah 1 menit. Pastikan telepon
                  tersambung internet, lalu coba lagi.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={props.connecting || !props.tos}
                  onClick={props.onConnect}
                >
                  <Plug size={16} />
                  Coba Lagi
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </ConfigureCard>
  );
}
