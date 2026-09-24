// Message templates management page. Two kinds:
// - CSQ shortcut: free-form text the system sends inside the 24h WhatsApp
//   window (session-close, fallback, greetings). No Meta approval needed.
// - META template: the name of a template approved in Meta Business Manager,
//   used for business-initiated sends OUTSIDE the 24h window.
// Owner-only writes; staff can view.
import { useState } from "react";
import type { FormEvent } from "react";
import type { GetServerSideProps } from "next";
import { useSession } from "next-auth/react";
import { Notepad, Plus, PencilSimple, Trash } from "@phosphor-icons/react";
import { withAuth } from "@/lib/auth";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import type { ApiResponse } from "@/types/api";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { StateNotice } from "@/components/dashboard/state-notice";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type TemplateKind = "CSQ" | "META";

type MessageTemplate = {
  id: string;
  key: string;
  label: string;
  kind: TemplateKind;
  body: string;
  metaName?: string;
  metaLanguage?: string;
};

type SystemKey = { key: string; description: string };

type ListResult = { items: MessageTemplate[]; systemKeys: SystemKey[] };

const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm placeholder-slate-400 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20";

export default function TemplatesPage() {
  const { data: session } = useSession();
  const isOwner = session?.user?.role === "OWNER";

  const { data, loading, error, refresh } = useApi<ListResult>(
    "/api/dashboard/templates"
  );
  const items = data?.items ?? [];
  const systemKeys = data?.systemKeys ?? [];

  const [editing, setEditing] = useState<MessageTemplate | "new" | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const form = new FormData(e.currentTarget);
    const isNew = editing === "new";
    const payload = {
      key: String(form.get("key") ?? "").trim(),
      label: String(form.get("label") ?? "").trim(),
      kind: String(form.get("kind") ?? "CSQ") as TemplateKind,
      body: String(form.get("body") ?? "").trim(),
      metaName: String(form.get("metaName") ?? "").trim() || undefined,
      metaLanguage: String(form.get("metaLanguage") ?? "").trim() || undefined,
    };
    setSaving(true);
    setFormError(null);
    try {
      if (isNew) {
        await apiSend<MessageTemplate>("/api/dashboard/templates", "POST", payload);
      } else {
        // PUT replaces the whole list; merge the edited item in.
        const next = items.map((t) =>
          t.id === (editing as MessageTemplate).id ? { ...t, ...payload } : t
        );
        await apiSend("/api/dashboard/templates", "PUT", next);
      }
      setEditing(null);
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal menyimpan template.");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(id: string) {
    setFormError(null);
    try {
      await apiSend(`/api/dashboard/templates?id=${id}`, "DELETE");
      refresh();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal menghapus template.");
    }
  }

  const dialogTemplate = editing === "new" ? null : editing;

  return (
    <DashboardShell
      title="Template Pesan"
      description="Kelola template pesan CSQ (teks bebas dalam window 24 jam) dan template Meta (wajib di-approve di Meta, untuk pesan proaktif di luar window)."
    >
      {formError && (
        <p className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700">
          {formError}
        </p>
      )}
      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Key sistem yang dikenal platform:{" "}
          {systemKeys.length > 0
            ? systemKeys.map((k) => (
                <code
                  key={k.key}
                  title={k.description}
                  className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700"
                >
                  {k.key}
                </code>
              ))
            : "—"}
        </p>
        {isOwner && (
          <Button onClick={() => setEditing("new")}>
            <Plus size={16} /> Tambah Template
          </Button>
        )}
      </div>

      {loading && <StateNotice variant="empty" message="Memuat template…" />}
      {!loading && items.length === 0 && (
        <StateNotice
          variant="empty"
          message="Belum ada template. Tambahkan template CSQ untuk pesan otomatis, atau daftarkan nama template Meta yang sudah di-approve."
        />
      )}

      {items.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((t) => {
            const sys = systemKeys.find((k) => k.key === t.key);
            return (
              <div
                key={t.id}
                className="flex flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="mb-2 flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {t.label}
                    </p>
                    <code className="text-xs text-slate-500">{t.key}</code>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
                      t.kind === "META"
                        ? "bg-blue-50 text-blue-700"
                        : "bg-green-50 text-green-700"
                    )}
                  >
                    {t.kind === "META" ? "Meta" : "CSQ"}
                  </span>
                </div>
                <p className="mb-3 min-h-[3rem] whitespace-pre-line rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
                  {t.kind === "META"
                    ? `Nama template Meta: ${t.metaName ?? "—"} (${t.metaLanguage ?? "id"})`
                    : t.body}
                </p>
                {sys && (
                  <p className="mb-3 text-[11px] text-slate-400">{sys.description}</p>
                )}
                {isOwner && (
                  <div className="mt-auto flex gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setEditing(t)}
                    >
                      <PencilSimple size={14} /> Edit
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void onDelete(t.id)}
                    >
                      <Trash size={14} />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={dialogTemplate ? "Edit Template" : "Tambah Template"}
      >
        <form onSubmit={onSave} className="space-y-3">
          <div>
            <Label htmlFor="tpl-label">Nama</Label>
            <Input
              id="tpl-label"
              name="label"
              defaultValue={dialogTemplate?.label ?? ""}
              placeholder="Mis. Pesan penutup sesi"
              required
            />
          </div>
          <div>
            <Label htmlFor="tpl-key">Key</Label>
            <Input
              id="tpl-key"
              name="key"
              defaultValue={dialogTemplate?.key ?? ""}
              placeholder="mis. session_end"
              pattern="[a-z0-9_]+"
              title="huruf kecil, angka, underscore"
              required
            />
            <p className="mt-1 text-xs text-slate-400">
              Gunakan key sistem (seperti session_end) agar dipakai otomatis oleh
              platform.
            </p>
          </div>
          <div>
            <Label htmlFor="tpl-kind">Jenis</Label>
            <select
              id="tpl-kind"
              name="kind"
              defaultValue={dialogTemplate?.kind ?? "CSQ"}
              className={inputCls}
            >
              <option value="CSQ">
                CSQ — teks bebas (dalam window 24 jam)
              </option>
              <option value="META">
                Meta — nama template yang sudah di-approve
              </option>
            </select>
          </div>
          <div>
            <Label htmlFor="tpl-body">Isi pesan</Label>
            <textarea
              id="tpl-body"
              name="body"
              defaultValue={dialogTemplate?.body ?? ""}
              rows={3}
              placeholder="Teks pesan yang dikirim ke pelanggan…"
              required
              className={cn(inputCls, "resize-y")}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="tpl-meta-name">Nama template Meta (khusus jenis Meta)</Label>
              <Input
                id="tpl-meta-name"
                name="metaName"
                defaultValue={dialogTemplate?.metaName ?? ""}
                placeholder="mis. session_close_v1"
              />
            </div>
            <div>
              <Label htmlFor="tpl-meta-lang">Bahasa template Meta</Label>
              <Input
                id="tpl-meta-lang"
                name="metaLanguage"
                defaultValue={dialogTemplate?.metaLanguage ?? "id"}
                placeholder="id"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setEditing(null)}
              disabled={saving}
            >
              Batal
            </Button>
            <Button type="submit" disabled={saving}>
              <Notepad size={16} />
              {saving ? "Menyimpan…" : "Simpan"}
            </Button>
          </div>
        </form>
      </Dialog>
    </DashboardShell>
  );
}

export const getServerSideProps: GetServerSideProps = withAuth(async () => ({
  props: {},
}));
