// The campaign form sections - ALL on one page (owner request 2026-11-10:
// no step navigation). Each section carries a numbered badge and a dashed
// separator, in the saluran stepper's visual language.
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

type WizardFormProps = {
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
  previewByCategory: { categoryId: string; name: string; count: number }[];
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

// Numbered badge + dashed rule: the section separator style the owner asked
// for - the badge of the stepper, with a dash filling the rest of the row.
function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-600 text-xs font-semibold text-white">
          {n}
        </span>
        <h3 className="shrink-0 text-sm font-semibold text-slate-900">{title}</h3>
        <span className="h-px flex-1 border-t border-dashed border-slate-300" />
      </div>
      {children}
    </section>
  );
}

export function CampaignWizardForm(props: WizardFormProps) {
  const cloudChannel =
    props.channels.find((c) => c.id === props.channelId)?.provider === "CLOUD_API";
  const estimate = props.audience === "ALL" ? props.contactTotal : props.previewTotal ?? 0;

  return (
    <div className="flex flex-col gap-8">
      {/* ── 1. Dasar ── */}
      <Section n={1} title="Dasar">
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
              <option value="">Pilih saluran...</option>
              {props.channels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.provider === "CLOUD_API"
                    ? `WhatsApp API${c.phoneNumberId ? ` (${c.phoneNumberId})` : ""}`
                    : "WhatsApp pribadi (Baileys)"}
                </option>
              ))}
            </Select>
            {cloudChannel && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700">
                Di saluran resmi (Cloud API), pesan bebas hanya sampai ke pelanggan yang chat
                &lt;24 jam terakhir; sisanya dilewati (tercatat). Untuk menjangkau semua, gunakan
                template yang sudah disetujui Meta.
              </p>
            )}
          </div>
        </div>
      </Section>

      {/* ── 2. Penerima ── */}
      <Section n={2} title="Penerima">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Penerima</Label>
            <Select
              value={props.audience}
              onChange={(e) =>
                props.onAudience(e.target.value as WizardFormProps["audience"])
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
              {props.audience === "ALL" ? props.contactTotal || "..." : props.previewTotal ?? "..."}
            </strong>
          </p>
          {props.audience === "CATEGORY" && props.previewByCategory.length > 0 && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
              <p className="mb-1 font-medium">Rincian per kategori:</p>
              {props.previewByCategory.map((c) => (
                <p key={c.categoryId} className="flex justify-between">
                  <span>{c.name}</span>
                  <span className="font-medium">{c.count}</span>
                </p>
              ))}
            </div>
          )}
          {estimate > 250 && (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700">
              Perhatian: audiens di atas 250 penerima. Batas awal pengiriman template Meta
              adalah 250 penerima unik per 24 jam di luar jendela chat (naik ke 2.000
              setelah verifikasi bisnis) - penerima di atasnya berisiko gagal terkirim.
            </p>
          )}
          {cloudChannel && (
            <p className="rounded-md border border-blue-500/30 bg-blue-500/10 p-2 text-xs text-blue-700">
              Di saluran resmi (Cloud API), setiap pesan terkirim dikenakan biaya per
              pesan oleh Meta sesuai tarif pasar. Pesan bebas hanya sampai ke pelanggan
              yang chat dalam 24 jam terakhir.
            </p>
          )}
        </div>
      </Section>

      {/* ── 3. Pesan ── */}
      <Section n={3} title="Pesan">
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
            {props.templates.find((t) => t.key === props.templateKey)?.kind === "META" && (
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
              placeholder="Tulis isi pesan kampanye..."
            />
            <span className="text-xs text-slate-400">
              Jika kampanye memakai tepat satu gambar, teks ini dikirim sebagai keterangan
              (caption) gambar - satu gelembung pesan.
            </span>
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
      </Section>

      {/* ── 4. Jadwal ── */}
      <Section n={4} title="Jadwal">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Jadwal</Label>
            <Select
              value={props.scheduleKind}
              onChange={(e) =>
                props.onScheduleKind(e.target.value as WizardFormProps["scheduleKind"])
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
                ± {props.previewTotal} kontak × {props.delaySeconds} dtk ={" "}
                {Math.round((props.previewTotal * props.delaySeconds) / 60)} menit per kirim
              </p>
            )}
          </div>
        </div>
      </Section>
    </div>
  );
}
