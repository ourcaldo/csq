// Message templates management page. Two kinds:
// - CSQ shortcut: free-form text the system sends inside the 24h WhatsApp
//   window (session-close, fallback, greetings). No Meta approval needed.
// - META template: the name of a template approved in Meta Business Manager,
//   used for business-initiated sends OUTSIDE the 24h window.
// Owner-only writes; staff can view.
//
// The template key is a system concern — never surfaced as a free-text field
// on the page. The owner picks a SYSTEM key from a dropdown (with its
// description) or "Lainnya" to define a custom key (label-only in the UI).
// Duplicate (key, kind) is rejected by the API POST path; editing an existing
// system key updates it in place.
import { useMemo, useState } from "react";
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

type SystemKey = { key: string; label?: string; description: string };

type ListResult = { items: MessageTemplate[]; systemKeys: SystemKey[] };

const inputCls =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm placeholder-slate-400 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500/20";

// Select option value encoding: "sys:<key>" for a system key, "custom" for a
// new custom key, "<key>" (plain) for a pre-existing custom key being edited.
function keyToOption(key: string, systemKeys: SystemKey[]): string {
  return systemKeys.some((k) => k.key === key) ? `sys:${key}` : key || "custom";
}

function optionToKey(value: string, customKey: string): string {
  if (value === "custom") return customKey.trim();
  return value.startsWith("sys:") ? value.slice(4) : value;
}

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

  // Kind drives which fields render; key selection drives sys/custom split.
  const dialogTemplate = editing === "new" ? null : editing;
  const [formKind, setFormKind] = useState<TemplateKind>("CSQ");
  const [keyOption, setKeyOption] = useState("custom");
  const [customKey, setCustomKey] = useState("");

  function openForm(t: MessageTemplate | "new") {
    setFormError(null);
    if (t === "new") {
      setEditing("new");
      setFormKind("CSQ");
      setKeyOption("custom");
      setCustomKey("");
    } else {
      setEditing(t);
      setFormKind(t.kind);
      setKeyOption(keyToOption(t.key, systemKeys));
      setCustomKey(t.key);
    }
  }

  async function onSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const form = new FormData(e.currentTarget);
    const key = optionToKey(
      String(form.get("keyOption") ?? keyOption),
      customKey
    );
    if (!key) {
      setFormError("Key template wajib diisi.");
      return;
    }
    const payload = {
      key,
      label: String(form.get("label") ?? "").trim(),
      kind: formKind,
      body: String(form.get("body") ?? "").trim(),
      metaName: String(form.get("metaName") ?? "").trim() || undefined,
      metaLanguage: String(form.get("metaLanguage") ?? "").trim() || undefined,
    };
    setSaving(true);
    setFormError(null);
    try {
      if (editing === "new") {
        await apiSend<MessageTemplate>("/api/dashboard/templates", "POST", payload);
      } else {
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

  const selectedSystem = useMemo(
    () => systemKeys.find((k) => `sys:${k.key}` === keyOption),
    [systemKeys, keyOption]
  );

  // System keys already in use for the current kind — disabled in the dropdown
  // (one template per key per kind).
  const usedSysKeys = new Set(
    items
      .filter((t) => t.kind === formKind && t.id !== dialogTemplate?.id)
      .map((t) => t.key)
  );

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

      <div className="mb-4 flex items-center justify-end">
        {isOwner && (
          <Button onClick={() => openForm("new")}>
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
                    {sys && (
                      <span className="text-[11px] text-slate-400">
                        {sys.description}
                      </span>
                    )}
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
                {isOwner && (
                  <div className="mt-auto flex gap-2 pt-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openForm(t)}
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
            <Label htmlFor="tpl-kind">Jenis</Label>
            <select
              id="tpl-kind"
              name="kind"
              value={formKind}
              onChange={(e) => setFormKind(e.target.value as TemplateKind)}
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
            <Label htmlFor="tpl-key-option">Fungsi template</Label>
            <select
              id="tpl-key-option"
              name="keyOption"
              value={keyOption}
              onChange={(e) => setKeyOption(e.target.value)}
              className={inputCls}
            >
              {systemKeys.map((k) => (
                <option
                  key={k.key}
                  value={`sys:${k.key}`}
                  disabled={usedSysKeys.has(k.key)}
                >
                  {k.label ?? k.key}
                </option>
              ))}
              <option value="custom">Lainnya (buat sendiri)</option>
            </select>
            {selectedSystem ? (
              <p className="mt-1 text-xs text-slate-400">
                {selectedSystem.description}
              </p>
            ) : (
              keyOption === "custom" && (
                <div className="mt-2">
                  <Input
                    value={customKey}
                    onChange={(e) => setCustomKey(e.target.value)}
                    placeholder="Nama fungsi (huruf kecil, angka, underscore)"
                    pattern="[a-z0-9_]+"
                    title="huruf kecil, angka, underscore"
                  />
                </div>
              )
            )}
          </div>

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

          {formKind === "CSQ" ? (
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
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="tpl-meta-name">Nama template Meta</Label>
                <Input
                  id="tpl-meta-name"
                  name="metaName"
                  defaultValue={dialogTemplate?.metaName ?? ""}
                  placeholder="mis. session_close_v1"
                  required
                />
              </div>
              <div>
                <Label htmlFor="tpl-meta-lang">Bahasa</Label>
                <Input
                  id="tpl-meta-lang"
                  name="metaLanguage"
                  defaultValue={dialogTemplate?.metaLanguage ?? "id"}
                  placeholder="id"
                />
              </div>
            </div>
          )}

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
