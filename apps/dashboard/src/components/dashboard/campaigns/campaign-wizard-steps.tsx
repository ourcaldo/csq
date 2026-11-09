import type { ChangeEvent } from "react";
import type { Category, Contact, Tag } from "@csq/core/types/dashboard";
import { Button } from "@csq/ui/components/ui/button";
import { Input } from "@csq/ui/components/ui/input";
import { Label } from "@csq/ui/components/ui/label";
import { Select } from "@csq/ui/components/ui/select";
import { Textarea } from "@csq/ui/components/ui/textarea";
import { WEEKDAYS, localDateTimeString } from "./format";

export type MessageTemplateRow = {
  id: string;
  key: string;
  label: string;
  kind: "CSQ" | "META";
  body: string;
  metaName?: string;
  metaLanguage?: string;
};

type ChannelOption = { id: string; provider: string; phoneNumberId?: string };

type WizardProps = {
  step: number;
  channels: ChannelOption[];
  channelId: string;
  onChannelId: (v: string) => void;
  name: string;
  onName: (v: string) => void;
  audience: "ALL" | "CATEGORY" | "TAGS" | "MANUAL";
  onAudience: (v: "ALL" | "CATEGORY" | "TAGS" | "MANUAL") => void;
  categories: Category[];
  categoryIds: string[];
  onToggleCategory: (id: string) => void;
  tags: Tag[];
  tagIds: string[];
  onToggleTag: (id: string) => void;
  contacts: Contact[];
  contactTotal: number;
  contactIds: string[];
  onToggleContact: (id: string) => void;
  previewTotal: number | null;
  templates: MessageTemplateRow[];
  templateKey: string;
  onTemplateKey: (v: string) => void;
  body: string;
  onBody: (v: string) => void;
  images: Array<{ id: string; url: string }>;
  onRemoveImage: (id: string) => void;
  onUpload: (e: ChangeEvent<HTMLInputElement>) => void;
  uploading: boolean;
  scheduleKind: "ONCE" | "DAILY" | "WEEKLY" | "MONTHLY" | "INTERVAL";
  onScheduleKind: (v: "ONCE" | "DAILY" | "WEEKLY" | "MONTHLY" | "INTERVAL") => void;
  onceAt: string;
  onOnceAt: (v: string) => void;
  time: string;
  onTime: (v: string) => void;
  dayOfWeek: number;
  onDayOfWeek: (v: number) => void;
  dayOfMonth: number;
  onDayOfMonth: (v: number) => void;
  everyDays: number;
  onEveryDays: (v: number) => void;
  delaySeconds: number;
  onDelaySeconds: (v: number) => void;
};

// The four wizard steps. State and submit live in the page; this component is
// presentational so the page file stays readable (PRD 09 page-splitting).
export function CampaignWizardSteps(props: WizardProps) {
  if (props.step === 1) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="campaign-name">Nama kampanye</Label>
          <Input
            id="campaign-name"
            required
            value={props.name}
            onChange={(e) => props.onName(e.target.value)}
            placeholder="mis. Promo Akhir Pekan"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="campaign-channel">Saluran kirim</Label>
          <Select
            id="campaign-channel"
            value={props.channelId}
            onChange={(e) => props.onChannelId(e.target.value)}
          >
            <option value="">Pilih saluran…</option>
            {props.channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.provider === "CLOUD_API"
                  ? `WhatsApp API${c.phoneNumberId ? ` (${c.phoneNumberId})` : ""}`
                  : "WhatsApp pribadi (Baileys)"}
              </option>
            ))}
          </Select>
          {props.channels.find((c) => c.id === props.channelId)?.provider === "CLOUD_API" && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700">
              Di saluran resmi (Cloud API), pesan bebas hanya sampai ke pelanggan yang chat
              &lt;24 jam terakhir; sisanya dilewati (tercatat). Untuk menjangkau semua, gunakan
              template yang sudah disetujui Meta.
            </p>
          )}
        </div>
      </div>
    );
  }

  if (props.step === 2) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label>Penerima</Label>
          <Select
            value={props.audience}
            onChange={(e) =>
              props.onAudience(e.target.value as WizardProps["audience"])
            }
          >
            <option value="ALL">Semua kontak</option>
            <option value="CATEGORY">Per kategori</option>
            <option value="TAGS">Per tag</option>
            <option value="MANUAL">Pilih manual</option>
          </Select>
        </div>
        {props.audience === "CATEGORY" && (
          <div className="flex flex-col gap-1.5">
            <Label>Kategori</Label>
            <div className="max-h-32 overflow-y-auto rounded-md border p-2">
              {props.categories.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Belum ada kategori - buat dulu di halaman Tag.
                </p>
              )}
              {props.categories.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-2 px-1 py-0.5 text-sm">
                  <input
                    type="checkbox"
                    checked={props.categoryIds.includes(c.id)}
                    onChange={() => props.onToggleCategory(c.id)}
                    className="h-4 w-4"
                  />
                  {c.name}
                </label>
              ))}
            </div>
          </div>
        )}
        {props.audience === "TAGS" && (
          <div className="flex flex-col gap-1.5">
            <Label>Tag</Label>
            <div className="max-h-32 overflow-y-auto rounded-md border p-2">
              {props.tags.map((t) => (
                <label key={t.id} className="flex cursor-pointer items-center gap-2 px-1 py-0.5 text-sm">
                  <input
                    type="checkbox"
                    checked={props.tagIds.includes(t.id)}
                    onChange={() => props.onToggleTag(t.id)}
                    className="h-4 w-4"
                  />
                  {t.name}
                </label>
              ))}
            </div>
          </div>
        )}
        {props.audience === "MANUAL" && (
          <div className="flex flex-col gap-1.5">
            <Label>Kontak ({props.contactTotal} terdaftar, 200 pertama tampil)</Label>
            <div className="max-h-40 overflow-y-auto rounded-md border p-2">
              {props.contacts.map((c) => (
                <label key={c.id} className="flex cursor-pointer items-center gap-2 px-1 py-0.5 text-sm">
                  <input
                    type="checkbox"
                    checked={props.contactIds.includes(c.id)}
                    onChange={() => props.onToggleContact(c.id)}
                    className="h-4 w-4"
                  />
                  {c.name ?? c.phoneDisplay ?? c.phone}
                </label>
              ))}
            </div>
          </div>
        )}
        <p className="text-sm text-muted-foreground">
          Estimasi penerima:{" "}
          <strong>
            {props.audience === "ALL" ? props.contactTotal || "…" : props.previewTotal ?? "…"}
          </strong>
        </p>
      </div>
    );
  }

  if (props.step === 3) {
    const template = props.templates.find((t) => t.key === props.templateKey);
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="campaign-template">Dari template (opsional)</Label>
          <Select
            id="campaign-template"
            value={props.templateKey}
            onChange={(e) => props.onTemplateKey(e.target.value)}
          >
            <option value="">Tulis baru</option>
            {props.templates.map((t) => (
              <option key={t.id} value={t.key}>
                {t.label} ({t.kind === "META" ? "Template Meta" : "CSQ"})
              </option>
            ))}
          </Select>
          {template?.kind === "META" && (
            <p className="rounded-md border border-blue-500/30 bg-blue-500/10 p-2 text-xs text-blue-700">
              Template Meta dipilih - teks di bawah tetap wajib (dipakai di saluran Baileys
              dan pratinjau); pelanggan di luar jendela 24 jam menerima template Meta
              tersebut.
            </p>
          )}
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="campaign-body">Isi pesan</Label>
          <Textarea
            id="campaign-body"
            rows={4}
            value={props.body}
            onChange={(e) => props.onBody(e.target.value)}
            placeholder="Tulis isi pesan kampanye…"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="campaign-images">Gambar (maks 4, 5 MB per gambar)</Label>
          <input
            id="campaign-images"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={props.onUpload}
            disabled={props.uploading}
            className="text-sm"
          />
          {props.images.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {props.images.map((img) => (
                <div key={img.id} className="flex items-center gap-1 rounded-md border p-1">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt="" className="h-10 w-10 rounded object-cover" />
                  <button
                    type="button"
                    onClick={() => props.onRemoveImage(img.id)}
                    className="text-xs text-destructive hover:underline"
                  >
                    Hapus
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label>Jadwal</Label>
        <Select
          value={props.scheduleKind}
          onChange={(e) =>
            props.onScheduleKind(e.target.value as WizardProps["scheduleKind"])
          }
        >
          <option value="ONCE">Sekali, di waktu tertentu</option>
          <option value="DAILY">Setiap hari</option>
          <option value="WEEKLY">Setiap minggu</option>
          <option value="MONTHLY">Setiap bulan</option>
          <option value="INTERVAL">Setiap N hari</option>
        </Select>
      </div>
      {props.scheduleKind === "ONCE" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="campaign-once">Waktu kirim</Label>
          <Input
            id="campaign-once"
            type="datetime-local"
            required
            value={props.onceAt}
            onChange={(e) => props.onOnceAt(e.target.value)}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() =>
              // "Instant": the engine tick runs every minute, so now+2min
              // fires within about two minutes of saving + activating.
              props.onOnceAt(localDateTimeString(new Date(Date.now() + 2 * 60_000)))
            }
          >
            Kirim sekarang (± 2 menit)
          </Button>
        </div>
      )}
      {props.scheduleKind !== "ONCE" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="campaign-time">Jam kirim (WIB)</Label>
          <Input
            id="campaign-time"
            type="time"
            required
            value={props.time}
            onChange={(e) => props.onTime(e.target.value)}
          />
        </div>
      )}
      {props.scheduleKind === "WEEKLY" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="campaign-dow">Hari</Label>
          <Select
            id="campaign-dow"
            value={String(props.dayOfWeek)}
            onChange={(e) => props.onDayOfWeek(Number(e.target.value))}
          >
            {WEEKDAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </Select>
        </div>
      )}
      {props.scheduleKind === "MONTHLY" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="campaign-dom">Tanggal</Label>
          <Input
            id="campaign-dom"
            type="number"
            min={1}
            max={31}
            required
            value={props.dayOfMonth}
            onChange={(e) => props.onDayOfMonth(Number(e.target.value))}
          />
        </div>
      )}
      {props.scheduleKind === "INTERVAL" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="campaign-interval">Setiap berapa hari</Label>
          <Input
            id="campaign-interval"
            type="number"
            min={1}
            max={365}
            required
            value={props.everyDays}
            onChange={(e) => props.onEveryDays(Number(e.target.value))}
          />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="campaign-delay">Jeda antar kontak (detik)</Label>
        <Input
          id="campaign-delay"
          type="number"
          min={10}
          max={3600}
          required
          value={props.delaySeconds}
          onChange={(e) => props.onDelaySeconds(Number(e.target.value))}
        />
        {props.previewTotal !== null && (
          <p className="text-xs text-muted-foreground">
            ± {props.previewTotal} kontak × {props.delaySeconds} dtk ≈{" "}
            {Math.round((props.previewTotal * props.delaySeconds) / 60)} menit per kirim
          </p>
        )}
      </div>
    </div>
  );
}
