import { Cloud, WhatsappLogo } from "@phosphor-icons/react";
import { BadgeStatus } from "@/components/dashboard/badge-status";
import { Button } from "@csq/ui/components/ui/button";
import { Separator } from "@csq/ui/components/ui/separator";
import { ReadOnlyField } from "./field";
import { TestBox } from "./test-box";
import type { ChannelView } from "./types";

export function ConnectedChannelCard(props: {
  channel: ChannelView;
  webhookUrl: string;
  cloudVerifyToken: string | null;
  isOwner: boolean;
  onEdit: () => void;
  onDisconnect: () => void;
  testTo: Record<string, string>;
  testing: string | null;
  onTestTo: (v: string) => void;
  onTest: () => void;
}) {
  const channel = props.channel;
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 p-5 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-600 text-white">
            {channel.provider === "CLOUD_API" ? (
              <Cloud size={20} weight="fill" />
            ) : (
              <WhatsappLogo size={20} weight="fill" />
            )}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-slate-900">
                {channel.provider === "CLOUD_API"
                  ? "WhatsApp Resmi"
                  : "Bawa Nomor Sendiri"}
              </h2>
              <BadgeStatus tone="green">Terhubung</BadgeStatus>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              {channel.provider === "CLOUD_API"
                ? `Phone Number ID: ${channel.phoneNumberId ?? "-"}`
                : "Terhubung via pindaian QR."}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {channel.provider === "CLOUD_API" && (
            <Button
              variant="outline"
              size="sm"
              disabled={!props.isOwner}
              onClick={props.onEdit}
            >
              Edit Kredensial
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={!props.isOwner}
            onClick={props.onDisconnect}
          >
            Putuskan
          </Button>
        </div>
      </div>
      <p className="px-5 pb-4 text-xs text-slate-400">
        Ingin berganti metode? Putuskan saluran ini, lalu pilih metode lain (mis.
        WhatsApp Resmi) dari langkah pertama.
      </p>
      {channel.provider === "CLOUD_API" && (
        <div className="space-y-3 px-5 pb-5">
          <Separator />
          <p className="pt-4 text-xs font-medium text-slate-600">
            Setelan webhook di Meta App Manager (WhatsApp - Configuration):
          </p>
          <ReadOnlyField label="Callback URL" value={props.webhookUrl} />
          <ReadOnlyField
            label="Verify Token"
            value={props.cloudVerifyToken ?? "-"}
            hint="Berganti otomatis setiap kali saluran disambungkan ulang - perbarui juga di Meta."
          />
        </div>
      )}
      <Separator />
      <div className="p-5">
        <TestBox
          id={channel.id}
          testTo={props.testTo}
          testing={props.testing}
          onTo={props.onTestTo}
          onTest={props.onTest}
          disabled={!props.isOwner}
        />
      </div>
    </div>
  );
}
