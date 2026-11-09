import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import type { GetServerSideProps } from "next";
import { useSession } from "next-auth/react";
import { withFeature } from "@csq/core/lib/auth";
import { apiFetch, apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import type { Category, Contact, ListResult, Tag } from "@csq/core/types/dashboard";
import type {
  CampaignRow,
  CampaignRunRow,
} from "@csq/core/types/campaign";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { ConfirmDialog } from "@/components/dashboard/confirm-dialog";
import { Dialog } from "@csq/ui/components/ui/dialog";
import { Button } from "@csq/ui/components/ui/button";
import { CampaignTable } from "@/components/dashboard/campaigns/campaign-table";
import { CampaignRunsDialog } from "@/components/dashboard/campaigns/campaign-runs-dialog";
import {
  CampaignWizardSteps,
  type MessageTemplateRow,
} from "@/components/dashboard/campaigns/campaign-wizard-steps";

type ChannelView = {
  id: string;
  provider: "CLOUD_API" | "BAILEYS";
  status: string;
  phoneNumberId?: string;
};



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
      <CampaignTable
        items={campaigns.data?.items ?? []}
        loading={campaigns.loading}
        error={campaigns.error}
        canManage={canManage}
        onRuns={openRuns}
        onEdit={openEdit}
        onActivate={onActivate}
        onPause={onPause}
        onDelete={setToDelete}
      />

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
          <CampaignWizardSteps
            step={step}
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

      <CampaignRunsDialog
        open={runsFor !== null}
        title={`Riwayat - ${runsFor?.name ?? ""}`}
        runs={runs}
        runDetail={runDetail}
        onClose={() => setRunsFor(null)}
        onToggleDetail={(id) =>
          runDetail?.id === id ? setRunDetail(null) : openRunDetail(id)
        }
      />

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
