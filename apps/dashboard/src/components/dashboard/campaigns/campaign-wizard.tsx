// Full-page campaign form (owner requests 2026-11-10: no popup, and no
// step navigation either - all four sections on one page, separated by the
// numbered badge + dashed rule headers). Owns the form state, the audience
// preview, media upload and the save call. Used by /dashboard/campaigns/baru
// (create) and /dashboard/campaigns/[id] (edit).
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { useRouter } from "next/router";
import { useSession } from "next-auth/react";
import { Checks, WhatsappLogo } from "@phosphor-icons/react";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import type { Category, Contact, ListResult, Tag } from "@csq/core/types/dashboard";
import type { CampaignRow } from "@csq/core/types/campaign";
import { Button } from "@csq/ui/components/ui/button";
import { StateNotice } from "@/components/dashboard/state-notice";
import { LoadingSkeleton } from "@/components/dashboard/loading-skeleton";
import { cn } from "@csq/ui/lib/utils";
import {
  CampaignWizardForm,
  type MessageTemplateRow,
} from "@/components/dashboard/campaigns/campaign-wizard-steps";

type ChannelView = {
  id: string;
  provider: "CLOUD_API" | "BAILEYS";
  status: string;
  label: string;
  phoneNumber: string | null;
  phoneNumberId?: string;
};

export function CampaignWizard({
  mode,
  campaign,
  apiMediaBase,
}: {
  mode: "create" | "edit";
  // Edit mode: the prefilled campaign row (fetched by the page).
  campaign: CampaignRow | null;
  apiMediaBase: string;
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const canManage =
    !!session?.user?.isOwner || !!session?.user?.permissions?.includes("kampanye.kelola");

  const channels = useApi<{ items: ChannelView[] }>("/api/dashboard/channels");
  const categories = useApi<Category[]>("/api/dashboard/contact-categories");
  const tags = useApi<ListResult<Tag>>("/api/dashboard/tags?pageSize=100");
  const contacts = useApi<ListResult<Contact>>("/api/dashboard/contacts?pageSize=200");
  const templates = useApi<{ items: MessageTemplateRow[] }>("/api/dashboard/templates");

  const connectedChannels = useMemo(
    () => (channels.data?.items ?? []).filter((c) => c.status === "CONNECTED"),
    [channels.data]
  );

  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [name, setName] = useState(campaign?.name ?? "");
  const [channelId, setChannelId] = useState(campaign?.channelId ?? "");

  const [audience, setAudience] = useState<"ALL" | "CATEGORY" | "TAGS" | "MANUAL">(
    campaign?.audience ?? "ALL"
  );
  const [categoryIds, setCategoryIds] = useState<string[]>(campaign?.categoryIds ?? []);
  const [tagIds, setTagIds] = useState<string[]>(campaign?.tagIds ?? []);
  const [contactIds, setContactIds] = useState<string[]>(campaign?.contactIds ?? []);
  const [previewTotal, setPreviewTotal] = useState<number | null>(null);
  const [previewByCategory, setPreviewByCategory] = useState<
    { categoryId: string; name: string; count: number }[]
  >([]);

  const [templateKey, setTemplateKey] = useState("");
  const [body, setBody] = useState(campaign?.body ?? "");
  const [images, setImages] = useState<Array<{ id: string; url: string }>>(
    campaign?.imageIds.map((id) => ({ id, url: `${apiMediaBase}/api/media/${id}` })) ?? []
  );
  const [uploading, setUploading] = useState(false);

  const [scheduleKind, setScheduleKind] = useState<
    "ONCE" | "DAILY" | "WEEKLY" | "MONTHLY" | "INTERVAL"
  >(campaign?.scheduleKind ?? "ONCE");
  const cfg = campaign?.scheduleConfig;
  const [onceAt, setOnceAt] = useState(
    cfg?.startAt ? new Date(cfg.startAt).toISOString().slice(0, 16) : ""
  );
  const [time, setTime] = useState(cfg?.time ?? "09:00");
  const [dayOfWeek, setDayOfWeek] = useState(cfg?.dayOfWeek ?? 1);
  const [dayOfMonth, setDayOfMonth] = useState(cfg?.dayOfMonth ?? 1);
  const [everyDays, setEveryDays] = useState(cfg?.everyDays ?? 7);
  const [delaySeconds, setDelaySeconds] = useState(campaign?.delaySeconds ?? 30);

  // PRD 28 Part C (campaign edit loses data): the edit page mounts the
  // wizard with campaign=null while the fetch is in flight, so the useState
  // initializers above captured null and every field rendered blank. When
  // the row arrives, populate every field once.
  const populatedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!campaign || populatedRef.current === campaign.id) return;
    populatedRef.current = campaign.id;
    setName(campaign.name);
    setChannelId(campaign.channelId);
    setAudience(campaign.audience);
    setCategoryIds(campaign.categoryIds);
    setTagIds(campaign.tagIds);
    setContactIds(campaign.contactIds);
    setBody(campaign.body);
    setImages(
      campaign.imageIds.map((id) => ({ id, url: `${apiMediaBase}/api/media/${id}` }))
    );
    setScheduleKind(campaign.scheduleKind);
    const c = campaign.scheduleConfig;
    setOnceAt(c.startAt ? new Date(c.startAt).toISOString().slice(0, 16) : "");
    setTime(c.time ?? "09:00");
    setDayOfWeek(c.dayOfWeek ?? 1);
    setDayOfMonth(c.dayOfMonth ?? 1);
    setEveryDays(c.everyDays ?? 7);
    setDelaySeconds(campaign.delaySeconds);
  }, [campaign, apiMediaBase]);

  // Live audience preview (advisory count - the engine resolves fresh at fire).
  useEffect(() => {
    if (audience === "ALL") {
      setPreviewTotal(null);
      setPreviewByCategory([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const data = await apiSend<{
          total: number;
          byCategory: { categoryId: string; name: string; count: number }[];
        }>("/api/dashboard/campaigns/preview", "POST", {
          audience,
          categoryIds,
          tagIds,
          contactIds,
        });
        if (!cancelled) {
          setPreviewTotal(data.total);
          setPreviewByCategory(data.byCategory ?? []);
        }
      } catch {
        if (!cancelled) setPreviewTotal(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audience, categoryIds, tagIds, contactIds]);

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
      if (mode === "edit" && campaign) {
        await apiSend(`/api/dashboard/campaigns/${campaign.id}`, "PUT", payload);
      } else {
        await apiSend("/api/dashboard/campaigns", "POST", payload);
      }
      router.push("/dashboard/campaigns");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal menyimpan kampanye.");
    } finally {
      setSaving(false);
    }
  }

  if (!canManage) {
    return (
      <StateNotice
        variant="error"
        message="Anda tidak punya izin kampanye. Minta owner mengaktifkan izin di halaman Tim."
      />
    );
  }

  const loading = channels.loading || (mode === "edit" && !campaign);

  // Live preview sidebar state (template redesign 2026-11-18): the selected
  // channel label + the WhatsApp bubble + the execution estimate.
  const selectedChannel = connectedChannels.find((c) => c.id === channelId);
  const isCloud = selectedChannel?.provider === "CLOUD_API";
  const previewText =
    body.trim() ||
    (templates.data?.items ?? []).find((t) => t.key === templateKey)?.body ||
    "";
  const estRecipients =
    previewTotal ?? (audience === "ALL" ? contacts.data?.total ?? 0 : 0);
  const estMinutes = Math.max(1, Math.round((estRecipients * delaySeconds) / 60));

  return (
    <form onSubmit={onSave} className="flex flex-col gap-6">
      {formError && (
        <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-600">
          {formError}
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* Left column: the 4-section form */}
        <div className="lg:col-span-8">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
            {loading ? (
              <LoadingSkeleton rows={8} />
            ) : (
              <CampaignWizardForm
                channels={connectedChannels}
                channelId={channelId}
                onChannelId={setChannelId}
                name={name}
                onName={setName}
                audience={audience}
                onAudience={setAudience}
                categories={categories.data ?? []}
                categoryIds={categoryIds}
                onToggleCategory={(id) => setCategoryIds((l) => toggle(l, id))}
                tags={tags.data?.items ?? []}
                tagIds={tagIds}
                onToggleTag={(id) => setTagIds((l) => toggle(l, id))}
                contacts={contacts.data?.items ?? []}
                contactTotal={contacts.data?.total ?? 0}
                contactIds={contactIds}
                onToggleContact={(id) => setContactIds((l) => toggle(l, id))}
                previewTotal={previewTotal}
                previewByCategory={previewByCategory}
                templates={templates.data?.items ?? []}
                templateKey={templateKey}
                onTemplateKey={setTemplateKey}
                body={body}
                onBody={setBody}
                images={images}
                onRemoveImage={(id) => setImages((l) => l.filter((x) => x.id !== id))}
                onUpload={onUpload}
                uploading={uploading}
                scheduleKind={scheduleKind}
                onScheduleKind={setScheduleKind}
                onceAt={onceAt}
                onOnceAt={setOnceAt}
                time={time}
                onTime={setTime}
                dayOfWeek={dayOfWeek}
                onDayOfWeek={setDayOfWeek}
                dayOfMonth={dayOfMonth}
                onDayOfMonth={setDayOfMonth}
                everyDays={everyDays}
                onEveryDays={setEveryDays}
                delaySeconds={delaySeconds}
                onDelaySeconds={setDelaySeconds}
              />
            )}
          </div>
        </div>

        {/* Right column: sticky live preview + delivery estimate (template redesign) */}
        <div className="lg:col-span-4">
          <div className="sticky top-24 space-y-4">
            {/* Live WhatsApp bubble preview */}
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                <div className="flex items-center gap-2">
                  <WhatsappLogo size={16} weight="fill" className="text-green-600" />
                  <span className="text-xs font-semibold text-slate-900">Pratinjau Pesan</span>
                </div>
                <span className="rounded bg-slate-200/70 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
                  {selectedChannel ? selectedChannel.label : "Belum pilih saluran"}
                </span>
              </div>
              <div className="bg-slate-100/80 p-4">
                <div className="ml-auto max-w-[90%] rounded-xl rounded-tr-xs border border-green-200/80 bg-green-50 p-3 shadow-xs">
                  {images.length > 0 && (
                    <div className="mb-2 grid grid-cols-2 gap-1.5">
                      {images.map((img) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={img.id}
                          src={img.url}
                          alt=""
                          className="h-20 w-full rounded-lg border border-green-200/60 object-cover"
                        />
                      ))}
                    </div>
                  )}
                  <p
                    className={cn(
                      "whitespace-pre-wrap text-xs leading-relaxed",
                      previewText ? "text-slate-800" : "italic text-slate-400"
                    )}
                  >
                    {previewText || "Isi pesan kampanye akan tampil di sini..."}
                  </p>
                  <div className="mt-1.5 flex items-center justify-end gap-1 text-[10px] text-slate-400">
                    <span>
                      {scheduleKind === "ONCE" && onceAt
                        ? new Date(onceAt).toTimeString().slice(0, 5)
                        : time}
                    </span>
                    <Checks size={12} weight="bold" className="text-blue-500" />
                  </div>
                </div>
              </div>
            </div>

            {/* Ringkasan Eksekusi */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold text-slate-900">Ringkasan Eksekusi</p>
              <div className="mt-3 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Estimasi Penerima</span>
                  <span className="font-semibold tabular-nums text-slate-900">
                    {audience === "ALL" ? contacts.data?.total ?? "..." : estRecipients || "..."} kontak
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Jeda Antar Pesan</span>
                  <span className="font-mono tabular-nums text-slate-700">{delaySeconds} detik</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Estimasi Durasi</span>
                  <span className="font-semibold tabular-nums text-slate-900">
                    &plusmn; {estMinutes} menit
                  </span>
                </div>
              </div>
              {isCloud && (
                <p className="mt-3 rounded-lg border border-blue-200 bg-blue-50 p-2 text-[11px] leading-relaxed text-blue-700">
                  Saluran resmi (Cloud API): pesan bebas hanya sampai ke pelanggan
                  dalam jendela 24 jam; sisanya dilewati (tercatat).
                </p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/dashboard/campaigns")}
          disabled={saving}
        >
          Batal
        </Button>
        <Button type="submit" disabled={saving || loading}>
          {saving ? "Menyimpan..." : mode === "edit" ? "Simpan Perubahan" : "Simpan"}
        </Button>
      </div>
    </form>
  );
}
