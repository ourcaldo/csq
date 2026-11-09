// Full-page campaign form (owner requests 2026-11-10: no popup, and no
// step navigation either - all four sections on one page, separated by the
// numbered badge + dashed rule headers). Owns the form state, the audience
// preview, media upload and the save call. Used by /dashboard/campaigns/baru
// (create) and /dashboard/campaigns/[id] (edit).
import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import { useRouter } from "next/router";
import { useSession } from "next-auth/react";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import type { Category, Contact, ListResult, Tag } from "@csq/core/types/dashboard";
import type { CampaignRow } from "@csq/core/types/campaign";
import { Button } from "@csq/ui/components/ui/button";
import { StateNotice } from "@/components/dashboard/state-notice";
import { LoadingSkeleton } from "@/components/dashboard/loading-skeleton";
import {
  CampaignWizardForm,
  type MessageTemplateRow,
} from "@/components/dashboard/campaigns/campaign-wizard-steps";

type ChannelView = {
  id: string;
  provider: "CLOUD_API" | "BAILEYS";
  status: string;
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
  const canManage = session?.user.role === "OWNER" || !!session?.user.canRunCampaigns;

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

  return (
    <form onSubmit={onSave} className="flex flex-col gap-6">
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

      {formError && <p className="text-sm text-destructive">{formError}</p>}

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
