import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { GetServerSideProps } from "next";
import { useSession } from "next-auth/react";
import { withFeature } from "@csq/core/lib/auth";
import { apiFetch, apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import type { Category, Contact, ListResult, Tag } from "@csq/core/types/dashboard";
import type {
  CampaignMessageRow,
  CampaignRow,
  CampaignRunRow,
} from "@csq/core/types/campaign";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { StateNotice } from "@/components/dashboard/state-notice";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { Dialog } from "@csq/ui/components/ui/dialog";
import { Button } from "@csq/ui/components/ui/button";
import { Input } from "@csq/ui/components/ui/input";
import { Label } from "@csq/ui/components/ui/label";
import { Select } from "@csq/ui/components/ui/select";
import { Textarea } from "@csq/ui/components/ui/textarea";
import { Badge } from "@csq/ui/components/ui/badge";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@csq/ui/components/ui/table";

type ChannelView = {
  id: string;
  provider: "CLOUD_API" | "BAILEYS";
  status: string;
  phoneNumberId?: string;
};

type MessageTemplateRow = {
  id: string;
  key: string;
  label: string;
  kind: "CSQ" | "META";
  body: string;
  metaName?: string;
  metaLanguage?: string;
};

const WEEKDAYS = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];

function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// Local-time "YYYY-MM-DDTHH:MM" for the datetime-local input (it is parsed
// back with `new Date(value)` in the browser's timezone, matching the market).
function localDateTimeString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function audienceLabel(c: CampaignRow): string {
  if (c.audience === "ALL") return "Semua kontak";
  if (c.audience === "MANUAL") return `${c.contactIds.length} kontak terpilih`;
  return c.audience === "CATEGORY" ? "Kategori" : "Tag";
}

function scheduleLabel(c: CampaignRow): string {
  const cfg = c.scheduleConfig;
  switch (c.scheduleKind) {
    case "ONCE":
      return `Sekali - ${formatDateTime(cfg.startAt ?? null)}`;
    case "DAILY":
      return `Setiap hari ${cfg.time}`;
    case "WEEKLY":
      return `Setiap ${WEEKDAYS[cfg.dayOfWeek ?? 0]} ${cfg.time}`;
    case "MONTHLY":
      return `Tanggal ${cfg.dayOfMonth} setiap bulan ${cfg.time}`;
    case "INTERVAL":
      return `Setiap ${cfg.everyDays} hari ${cfg.time}`;
  }
}

export default function CampaignsPage() {
  const { data: session } = useSession();
  const canManage = session?.user.role === "OWNER" || !!session?.user.canRunCampaigns;

  const campaigns = useApi<{ items: CampaignRow[] }>("/api/dashboard/campaigns");
  const channels = useApi<{ items: ChannelView[] }>("/api/dashboard/channels");
  const categories = useApi<Category[]>("/api/dashboard/contact-categories");
  const tags = useApi<ListResult<Tag>>("/api/dashboard/tags?pageSize=100");
  const contacts = useApi<ListResult<Contact>>("/api/dashboard/contacts?pageSize=200");
  const templates = useApi<{ items: MessageTemplateRow[] }>("/api/dashboard/templates");

  // ── Wizard state ──
  const [wizardOpen, setWizardOpen] = useState(false);
  const [editing, setEditing] = useState<CampaignRow | null>(null);
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [channelId, setChannelId] = useState("");

  const [audience, setAudience] = useState<"ALL" | "CATEGORY" | "TAGS" | "MANUAL">("ALL");
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [contactIds, setContactIds] = useState<string[]>([]);
  const [previewTotal, setPreviewTotal] = useState<number | null>(null);

  const [templateKey, setTemplateKey] = useState("");
  const [body, setBody] = useState("");
  const [images, setImages] = useState<Array<{ id: string; url: string }>>([]);
  const [uploading, setUploading] = useState(false);

  const [scheduleKind, setScheduleKind] = useState<"ONCE" | "DAILY" | "WEEKLY" | "MONTHLY" | "INTERVAL">("ONCE");
  const [onceAt, setOnceAt] = useState(""); // datetime-local
  const [time, setTime] = useState("09:00");
  const [dayOfWeek, setDayOfWeek] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(1);
  const [everyDays, setEveryDays] = useState(7);
  const [delaySeconds, setDelaySeconds] = useState(30);

  // ── Run history dialog ──
  const [runsFor, setRunsFor] = useState<CampaignRow | null>(null);
  const [runs, setRuns] = useState<CampaignRunRow[] | null>(null);
  const [runDetail, setRunDetail] = useState<CampaignRunRow | null>(null);

  // ── Delete ──
  const [toDelete, setToDelete] = useState<CampaignRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const connectedChannels = useMemo(
    () => (channels.data?.items ?? []).filter((c) => c.status === "CONNECTED"),
    [channels.data]
  );

  // Live audience preview (advisory count - the engine resolves fresh at fire).
  useEffect(() => {
    if (!wizardOpen || audience === "ALL") {
      setPreviewTotal(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const data = await apiSend<{ total: number }>("/api/dashboard/campaigns/preview", "POST", {
          audience,
          categoryIds,
          tagIds,
          contactIds,
        });
        if (!cancelled) setPreviewTotal(data.total);
      } catch {
        if (!cancelled) setPreviewTotal(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wizardOpen, audience, categoryIds, tagIds, contactIds]);

  function openCreate() {
    setEditing(null);
    setStep(1);
    setName("");
    setChannelId(connectedChannels[0]?.id ?? "");
    setAudience("ALL");
    setCategoryIds([]);
    setTagIds([]);
    setContactIds([]);
    setTemplateKey("");
    setBody("");
    setImages([]);
    setScheduleKind("ONCE");
    setOnceAt("");
    setTime("09:00");
    setDayOfWeek(1);
    setDayOfMonth(1);
    setEveryDays(7);
    setDelaySeconds(30);
    setFormError(null);
    setWizardOpen(true);
  }

  function openEdit(c: CampaignRow) {
    setEditing(c);
    setStep(1);
    setName(c.name);
    setChannelId(c.channelId);
    setAudience(c.audience);
    setCategoryIds(c.categoryIds);
    setTagIds(c.tagIds);
    setContactIds(c.contactIds);
    setTemplateKey("");
    setBody(c.body);
    setImages(c.imageIds.map((id) => ({ id, url: `/api/media/${id}` })));
    setScheduleKind(c.scheduleKind);
    const cfg = c.scheduleConfig;
    setOnceAt(cfg.startAt ? new Date(cfg.startAt).toISOString().slice(0, 16) : "");
    setTime(cfg.time ?? "09:00");
    setDayOfWeek(cfg.dayOfWeek ?? 1);
    setDayOfMonth(cfg.dayOfMonth ?? 1);
    setEveryDays(cfg.everyDays ?? 7);
    setDelaySeconds(c.delaySeconds);
    setFormError(null);
    setWizardOpen(true);
  }

  function toggle(list: string[], id: string): string[] {
    return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
  }

  async function onUpload(e: ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    if (images.length + files.length > 4) {
      setFormError("Maksimal 4 gambar per kampanye.");
      return;
    }
    setUploading(true);
    setFormError(null);
    try {
      for (const file of Array.from(files)) {
        if (file.size > 5 * 1024 * 1024) throw new Error("Gambar maksimal 5 MB.");
        const res = await fetch("/api/dashboard/media", {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });
        const json: { success?: boolean; error?: { message?: string }; data?: { id: string; url: string } } =
          await res.json();
        if (!res.ok || !json.data) {
          throw new Error(json.error?.message ?? "Gagal mengunggah gambar.");
        }
        setImages((l) => [...l, json.data!]);
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal mengunggah gambar.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setFormError(null);
    try {
      const scheduleConfig: Record<string, unknown> =
        scheduleKind === "ONCE"
          ? { startAt: new Date(onceAt).toISOString() }
          : scheduleKind === "WEEKLY"
            ? { time, dayOfWeek }
            : scheduleKind === "MONTHLY"
              ? { time, dayOfMonth }
              : scheduleKind === "INTERVAL"
                ? { time, everyDays }
                : { time };
      const payload = {
        name,
        channelId,
        audience,
        categoryIds,
        tagIds,
        contactIds,
        templateKey: templateKey || undefined,
        body: body || undefined,
        imageIds: images.map((i) => i.id),
        scheduleKind,
        scheduleConfig,
        delaySeconds,
      };
      if (editing) {
        await apiSend(`/api/dashboard/campaigns/${editing.id}`, "PUT", payload);
      } else {
        await apiSend("/api/dashboard/campaigns", "POST", payload);
      }
      setWizardOpen(false);
      campaigns.refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal menyimpan kampanye.");
    } finally {
      setSaving(false);
    }
  }

  async function onActivate(c: CampaignRow) {
    try {
      await apiSend(`/api/dashboard/campaigns/${c.id}/activate`, "POST");
      campaigns.refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal mengaktifkan kampanye.");
    }
  }

  async function onPause(c: CampaignRow) {
    try {
      await apiSend(`/api/dashboard/campaigns/${c.id}/pause`, "POST");
      campaigns.refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal menjeda kampanye.");
    }
  }

  async function onDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await apiSend(`/api/dashboard/campaigns/${toDelete.id}`, "DELETE");
      setToDelete(null);
      campaigns.refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal menghapus kampanye.");
    } finally {
      setDeleting(false);
    }
  }

  async function openRuns(c: CampaignRow) {
    setRunsFor(c);
    setRuns(null);
    setRunDetail(null);
    try {
      const data = await apiFetch<{ runs: CampaignRunRow[] }>(
        `/api/dashboard/campaigns/${c.id}/runs`
      );
      setRuns(data.runs);
    } catch {
      setRuns([]);
    }
  }

  async function openRunDetail(runId: string) {
    if (!runsFor) return;
    try {
      const data = await apiFetch<{ run: CampaignRunRow }>(
        `/api/dashboard/campaigns/${runsFor.id}/runs?runId=${runId}&pageSize=200`
      );
      setRunDetail(data.run);
    } catch {
      setRunDetail(null);
    }
  }

  const stepFields = (
    <>
      {step === 1 && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="campaign-name">Nama kampanye</Label>
            <Input
              id="campaign-name"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="mis. Promo Akhir Pekan"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="campaign-channel">Saluran kirim</Label>
            <Select
              id="campaign-channel"
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
            >
              <option value="">Pilih saluran…</option>
              {connectedChannels.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.provider === "CLOUD_API" ? `WhatsApp API${c.phoneNumberId ? ` (${c.phoneNumberId})` : ""}` : "WhatsApp pribadi (Baileys)"}
                </option>
              ))}
            </Select>
            {channelId && (channels.data?.items ?? []).find((c) => c.id === channelId)?.provider ===
              "CLOUD_API" && (
              <p className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-xs text-amber-700">
                Di saluran resmi (Cloud API), pesan bebas hanya sampai ke pelanggan yang chat
                &lt;24 jam terakhir; sisanya dilewati (tercatat). Untuk menjangkau semua, gunakan
                template yang sudah disetujui Meta.
              </p>
            )}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Penerima</Label>
            <Select
              value={audience}
              onChange={(e) => setAudience(e.target.value as typeof audience)}
            >
              <option value="ALL">Semua kontak</option>
              <option value="CATEGORY">Per kategori</option>
              <option value="TAGS">Per tag</option>
              <option value="MANUAL">Pilih manual</option>
            </Select>
          </div>
          {audience === "CATEGORY" && (
            <div className="flex flex-col gap-1.5">
              <Label>Kategori</Label>
              <div className="max-h-32 overflow-y-auto rounded-md border p-2">
                {(categories.data ?? []).length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Belum ada kategori - buat dulu di halaman Tag.
                  </p>
                )}
                {(categories.data ?? []).map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-2 px-1 py-0.5 text-sm">
                    <input
                      type="checkbox"
                      checked={categoryIds.includes(c.id)}
                      onChange={() => setCategoryIds((l) => toggle(l, c.id))}
                      className="h-4 w-4"
                    />
                    {c.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          {audience === "TAGS" && (
            <div className="flex flex-col gap-1.5">
              <Label>Tag</Label>
              <div className="max-h-32 overflow-y-auto rounded-md border p-2">
                {(tags.data?.items ?? []).map((t) => (
                  <label key={t.id} className="flex cursor-pointer items-center gap-2 px-1 py-0.5 text-sm">
                    <input
                      type="checkbox"
                      checked={tagIds.includes(t.id)}
                      onChange={() => setTagIds((l) => toggle(l, t.id))}
                      className="h-4 w-4"
                    />
                    {t.name}
                  </label>
                ))}
              </div>
            </div>
          )}
          {audience === "MANUAL" && (
            <div className="flex flex-col gap-1.5">
              <Label>Kontak ({contacts.data?.total ?? 0} terdaftar, 200 pertama tampil)</Label>
              <div className="max-h-40 overflow-y-auto rounded-md border p-2">
                {(contacts.data?.items ?? []).map((c) => (
                  <label key={c.id} className="flex cursor-pointer items-center gap-2 px-1 py-0.5 text-sm">
                    <input
                      type="checkbox"
                      checked={contactIds.includes(c.id)}
                      onChange={() => setContactIds((l) => toggle(l, c.id))}
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
            <strong>{audience === "ALL" ? contacts.data?.total ?? "…" : previewTotal ?? "…"}</strong>
          </p>
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="campaign-template">Dari template (opsional)</Label>
            <Select
              id="campaign-template"
              value={templateKey}
              onChange={(e) => setTemplateKey(e.target.value)}
            >
              <option value="">Tulis baru</option>
              {(templates.data?.items ?? []).map((t) => (
                <option key={t.id} value={t.key}>
                  {t.label} ({t.kind === "META" ? "Template Meta" : "CSQ"})
                </option>
              ))}
            </Select>
            {templateKey &&
              (templates.data?.items ?? []).find((t) => t.key === templateKey)?.kind === "META" && (
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
              value={body}
              onChange={(e) => setBody(e.target.value)}
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
              onChange={onUpload}
              disabled={uploading}
              className="text-sm"
            />
            {images.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {images.map((img) => (
                  <div key={img.id} className="flex items-center gap-1 rounded-md border p-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={img.url} alt="" className="h-10 w-10 rounded object-cover" />
                    <button
                      type="button"
                      onClick={() => setImages((l) => l.filter((x) => x.id !== img.id))}
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
      )}

      {step === 4 && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>Jadwal</Label>
            <Select
              value={scheduleKind}
              onChange={(e) => setScheduleKind(e.target.value as typeof scheduleKind)}
            >
              <option value="ONCE">Sekali, di waktu tertentu</option>
              <option value="DAILY">Setiap hari</option>
              <option value="WEEKLY">Setiap minggu</option>
              <option value="MONTHLY">Setiap bulan</option>
              <option value="INTERVAL">Setiap N hari</option>
            </Select>
          </div>
          {scheduleKind === "ONCE" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="campaign-once">Waktu kirim</Label>
              <Input
                id="campaign-once"
                type="datetime-local"
                required
                value={onceAt}
                onChange={(e) => setOnceAt(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="self-start"
                onClick={() =>
                  // "Instant": the engine tick runs every minute, so now+2min
                  // fires within about two minutes of saving + activating.
                  setOnceAt(localDateTimeString(new Date(Date.now() + 2 * 60_000)))
                }
              >
                Kirim sekarang (± 2 menit)
              </Button>
            </div>
          )}
          {scheduleKind !== "ONCE" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="campaign-time">Jam kirim (WIB)</Label>
              <Input
                id="campaign-time"
                type="time"
                required
                value={time}
                onChange={(e) => setTime(e.target.value)}
              />
            </div>
          )}
          {scheduleKind === "WEEKLY" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="campaign-dow">Hari</Label>
              <Select
                id="campaign-dow"
                value={String(dayOfWeek)}
                onChange={(e) => setDayOfWeek(Number(e.target.value))}
              >
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </Select>
            </div>
          )}
          {scheduleKind === "MONTHLY" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="campaign-dom">Tanggal</Label>
              <Input
                id="campaign-dom"
                type="number"
                min={1}
                max={31}
                required
                value={dayOfMonth}
                onChange={(e) => setDayOfMonth(Number(e.target.value))}
              />
            </div>
          )}
          {scheduleKind === "INTERVAL" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="campaign-interval">Setiap berapa hari</Label>
              <Input
                id="campaign-interval"
                type="number"
                min={1}
                max={365}
                required
                value={everyDays}
                onChange={(e) => setEveryDays(Number(e.target.value))}
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
              value={delaySeconds}
              onChange={(e) => setDelaySeconds(Number(e.target.value))}
            />
            {previewTotal !== null && (
              <p className="text-xs text-muted-foreground">
                ± {previewTotal} kontak × {delaySeconds} dtk ≈{" "}
                {Math.round((previewTotal * delaySeconds) / 60)} menit per kirim
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );

  return (
    <DashboardShell
      title="Kampanye"
      description="Kirim pesan promosi ke banyak kontak sekaligus, dengan jadwal dan tempo yang terkontrol."
      actions={canManage ? <Button onClick={openCreate}>Kampanye Baru</Button> : undefined}
    >
      {!canManage && (
        <p className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-700">
          Anda tidak punya izin kampanye. Minta owner mengaktifkan &quot;Boleh jalankan kampanye&quot;
          di halaman Tim.
        </p>
      )}
      {formError && <p className="mb-4 text-sm text-destructive">{formError}</p>}
      {campaigns.loading && <StateNotice variant="loading" message="Memuat kampanye…" />}
      {campaigns.error && <StateNotice variant="error" message={campaigns.error} />}
      {!campaigns.loading && !campaigns.error && (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nama</TableHead>
                <TableHead className="hidden md:table-cell">Penerima</TableHead>
                <TableHead className="hidden lg:table-cell">Jadwal</TableHead>
                <TableHead className="hidden xl:table-cell">Kirim berikutnya</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {campaigns.data && campaigns.data.items.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>
                    <StateNotice variant="empty" message="Belum ada kampanye." />
                  </TableCell>
                </TableRow>
              )}
              {campaigns.data?.items.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell className="hidden md:table-cell">{audienceLabel(c)}</TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">
                    {scheduleLabel(c)}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground xl:table-cell">
                    {formatDateTime(c.nextRunAt)}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={c.status === "ACTIVE" ? "success" : c.status === "PAUSED" ? "warning" : "secondary"}
                    >
                      {c.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    {canManage && (
                      <div className="flex flex-wrap justify-end gap-1">
                        <Button variant="outline" size="sm" onClick={() => openRuns(c)}>
                          Riwayat
                        </Button>
                        {c.status === "DRAFT" || c.status === "PAUSED" ? (
                          <>
                            <Button variant="outline" size="sm" onClick={() => openEdit(c)}>
                              Edit
                            </Button>
                            <Button size="sm" onClick={() => onActivate(c)}>
                              Aktifkan
                            </Button>
                          </>
                        ) : c.status === "ACTIVE" ? (
                          <Button variant="outline" size="sm" onClick={() => onPause(c)}>
                            Jeda
                          </Button>
                        ) : null}
                        {(c.status === "DRAFT" || c.status === "PAUSED") && (
                          <Button variant="destructive" size="sm" onClick={() => setToDelete(c)}>
                            Hapus
                          </Button>
                        )}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Wizard */}
      <Dialog
        open={wizardOpen}
        onClose={() => setWizardOpen(false)}
        title={editing ? "Edit Kampanye" : "Kampanye Baru"}
      >
        <form onSubmit={onSave} className="flex flex-col gap-4">
          {formError && <p className="text-sm text-destructive">{formError}</p>}
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Langkah {step} dari 4
          </p>
          {stepFields}
          <div className="flex justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setStep((s) => Math.max(1, s - 1))}
              disabled={step === 1}
            >
              Kembali
            </Button>
            {step < 4 ? (
              <Button type="button" onClick={() => setStep((s) => s + 1)}>
                Lanjut
              </Button>
            ) : (
              <Button type="submit" disabled={saving}>
                {saving ? "Menyimpan…" : "Simpan"}
              </Button>
            )}
          </div>
        </form>
      </Dialog>

      {/* Run history */}
      <Dialog
        open={runsFor !== null}
        onClose={() => setRunsFor(null)}
        title={`Riwayat - ${runsFor?.name ?? ""}`}
      >
        <div className="max-h-[60vh] space-y-3 overflow-y-auto">
          {runs === null && <StateNotice variant="loading" message="Memuat riwayat…" />}
          {runs !== null && runs.length === 0 && (
            <StateNotice variant="empty" message="Belum pernah kirim." />
          )}
          {runs?.map((r) => (
            <div key={r.id} className="rounded-md border p-3 text-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">{formatDateTime(r.startedAt)}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.finishedAt ? `Selesai ${formatDateTime(r.finishedAt)}` : "Sedang berjalan"} -{" "}
                    total {r.counts?.total ?? 0}, terkirim {r.counts?.sent ?? 0}, gagal{" "}
                    {r.counts?.failed ?? 0}, dilewati {r.counts?.skipped ?? 0}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => (runDetail?.id === r.id ? setRunDetail(null) : openRunDetail(r.id))}
                >
                  {runDetail?.id === r.id ? "Tutup" : "Detail"}
                </Button>
              </div>
              {runDetail?.id === r.id && (
                <div className="mt-3 max-h-48 overflow-y-auto rounded border">
                  {runDetail.messages?.length === 0 && (
                    <p className="p-2 text-xs text-muted-foreground">Tidak ada pesan.</p>
                  )}
                  {runDetail.messages?.map((m: CampaignMessageRow) => (
                    <div
                      key={m.id}
                      className="flex items-center justify-between border-b px-2 py-1 text-xs last:border-b-0"
                    >
                      <span className="font-mono">{m.phone}</span>
                      <span
                        className={
                          m.status === "SENT"
                            ? "text-green-600"
                            : m.status === "FAILED"
                              ? "text-destructive"
                              : m.status === "SKIPPED"
                                ? "text-amber-600"
                                : "text-muted-foreground"
                        }
                      >
                        {m.status === "PENDING" ? "menunggu" : m.status.toLowerCase()}
                        {m.reason ? ` - ${m.reason}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </Dialog>

      <ConfirmDialog
        open={toDelete !== null}
        title="Hapus Kampanye"
        description={`Yakin ingin menghapus kampanye "${toDelete?.name}"? Riwayat kirimnya ikut terhapus.`}
        confirmLabel="Hapus"
        destructive
        loading={deleting}
        onConfirm={onDelete}
        onCancel={() => setToDelete(null)}
      />
    </DashboardShell>
  );
}

export const getServerSideProps: GetServerSideProps = withFeature(
  "campaigns",
  async () => ({ props: {} })
);
