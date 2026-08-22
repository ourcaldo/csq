import { useEffect, useState } from "react";
import { z } from "zod";
import { apiFetch, apiSend, ApiError } from "@/lib/api-client";
import type { Stage, StageKind } from "@/types/inbox";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

// Stage customization dialog for the pipeline. Owner/staff can add, rename,
// reorder (up/down), and remove stages, and set winProbability/expectedDays.
// Enforces one OPENING / one WON / one LOST per pipeline (the API also enforces
// it, but we disable the option client-side when one already exists).

const KIND_LABEL: Record<StageKind, string> = {
  OPENING: "Tahap Awal",
  WON: "Menang",
  LOST: "Kalah",
  NORMAL: "Tahap Biasa",
};

type Props = {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
};

export function StageManager({ open, onClose, onChanged }: Props) {
  const [stages, setStages] = useState<Stage[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // New-stage form state.
  const [newName, setNewName] = useState("");
  const [newKind, setNewKind] = useState<StageKind>("NORMAL");
  const [newWin, setNewWin] = useState("");
  const [newDays, setNewDays] = useState("");

  // Inline edit state (stage id being edited, or null).
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editWin, setEditWin] = useState("");
  const [editDays, setEditDays] = useState("");

  async function load() {
    setBusy(true);
    setError(null);
    try {
      const data = await apiFetch<{ stages: Stage[] }>("/api/dashboard/pipeline");
      setStages(data.stages);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal memuat pipeline.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (open) void load();
  }, [open]);

  function resetNew() {
    setNewName("");
    setNewKind("NORMAL");
    setNewWin("");
    setNewDays("");
  }

  async function addStage() {
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await apiSend("/api/dashboard/pipeline/stages", "POST", {
        name: newName.trim(),
        kind: newKind,
        winProbability: newWin ? Number(newWin) : undefined,
        expectedDays: newDays ? Number(newDays) : undefined,
      });
      resetNew();
      void load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menambah tahap.");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(id: string) {
    setBusy(true);
    setError(null);
    try {
      await apiSend(`/api/dashboard/pipeline/stages/${id}`, "PUT", {
        name: editName.trim() || undefined,
        winProbability: editWin ? Number(editWin) : undefined,
        expectedDays: editDays ? Number(editDays) : undefined,
      });
      setEditId(null);
      void load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menyimpan tahap.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteStage(id: string, name: string) {
    if (!confirm(`Hapus tahap "${name}"?`)) return;
    setBusy(true);
    setError(null);
    try {
      await apiSend(`/api/dashboard/pipeline/stages/${id}`, "DELETE");
      void load();
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal menghapus tahap.");
    } finally {
      setBusy(false);
    }
  }

  async function move(id: string, dir: -1 | 1) {
    if (!stages) return;
    const idx = stages.findIndex((s) => s.id === id);
    if (idx < 0) return;
    const swap = idx + dir;
    if (swap < 0 || swap >= stages.length) return;
    const order = stages.map((s) => s.id);
    [order[idx], order[swap]] = [order[swap], order[idx]];
    setBusy(true);
    setError(null);
    try {
      await apiSend("/api/dashboard/pipeline/stages/reorder", "PUT", { order });
      void load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Gagal mengurutkan tahap.");
    } finally {
      setBusy(false);
    }
  }

  function startEdit(s: Stage) {
    setEditId(s.id);
    setEditName(s.name);
    setEditWin(s.winProbability != null ? String(s.winProbability) : "");
    setEditDays(s.expectedDays != null ? String(s.expectedDays) : "");
  }

  const usedKinds = new Set((stages ?? []).map((s) => s.kind));
  const ALL_KINDS: StageKind[] = ["OPENING", "NORMAL", "WON", "LOST"];
  const kindOptions = ALL_KINDS.filter(
    (k) => k === "NORMAL" || !usedKinds.has(k)
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Atur Tahap Pipeline"
      description="Tambah, ubah, urutkan, atau hapus tahap. Wajib ada satu tahap awal, satu Menang, satu Kalah."
      className="max-w-2xl"
    >
      <div className="space-y-4">
        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wider text-slate-500">
              <tr>
                <th className="px-2 py-2 text-left font-semibold">Urutan</th>
                <th className="px-2 py-2 text-left font-semibold">Nama</th>
                <th className="px-2 py-2 text-left font-semibold">Peran</th>
                <th className="px-2 py-2 text-left font-semibold">Win %</th>
                <th className="px-2 py-2 text-left font-semibold">Hari</th>
                <th className="px-2 py-2 text-right font-semibold">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {(stages ?? []).map((s, i) => (
                <tr key={s.id} className="border-t">
                  <td className="px-2 py-2">
                    <div className="flex gap-1">
                      <button
                        disabled={busy || i === 0}
                        onClick={() => move(s.id, -1)}
                        className="rounded px-1 text-slate-500 hover:text-slate-900 disabled:opacity-30"
                        aria-label="Naik"
                      >
                        ↑
                      </button>
                      <button
                        disabled={busy || i === (stages?.length ?? 0) - 1}
                        onClick={() => move(s.id, 1)}
                        className="rounded px-1 text-slate-500 hover:text-slate-900 disabled:opacity-30"
                        aria-label="Turun"
                      >
                        ↓
                      </button>
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    {editId === s.id ? (
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        disabled={busy}
                        className="h-8"
                      />
                    ) : (
                      <span className="font-medium">{s.name}</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-xs text-slate-600">{KIND_LABEL[s.kind]}</td>
                  <td className="px-2 py-2">
                    {editId === s.id ? (
                      <Input
                        type="number"
                        value={editWin}
                        onChange={(e) => setEditWin(e.target.value)}
                        disabled={busy}
                        className="h-8 w-20"
                        placeholder="0-1"
                      />
                    ) : (
                      <span className="text-xs text-slate-600">
                        {s.winProbability != null ? `${Math.round(s.winProbability * 100)}%` : "—"}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    {editId === s.id ? (
                      <Input
                        type="number"
                        value={editDays}
                        onChange={(e) => setEditDays(e.target.value)}
                        disabled={busy}
                        className="h-8 w-20"
                        placeholder="hari"
                      />
                    ) : (
                      <span className="text-xs text-slate-600">
                        {s.expectedDays != null ? `${s.expectedDays}h` : "—"}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <div className="flex justify-end gap-1.5">
                      {editId === s.id ? (
                        <>
                          <Button size="sm" onClick={() => saveEdit(s.id)} disabled={busy}>
                            Simpan
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => setEditId(null)} disabled={busy}>
                            Batal
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button size="sm" variant="outline" onClick={() => startEdit(s)} disabled={busy}>
                            Ubah
                          </Button>
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={() => deleteStage(s.id, s.name)}
                            disabled={busy}
                          >
                            Hapus
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Add a new stage */}
        <div className="rounded-lg border p-4">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
            Tambah Tahap
          </h4>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="sm:col-span-1">
              <Label htmlFor="new-name">Nama</Label>
              <Input
                id="new-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                disabled={busy}
                placeholder="mis. Penawaran"
              />
            </div>
            <div>
              <Label htmlFor="new-kind">Peran</Label>
              <Select
                id="new-kind"
                value={newKind}
                onChange={(e) => setNewKind(z.enum(["OPENING", "WON", "LOST", "NORMAL"]).parse(e.target.value))}
                disabled={busy || kindOptions.length === 0}
              >
                {kindOptions.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABEL[k]}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="new-win">Win %</Label>
              <Input
                id="new-win"
                type="number"
                value={newWin}
                onChange={(e) => setNewWin(e.target.value)}
                disabled={busy}
                placeholder="0-1"
              />
            </div>
            <div>
              <Label htmlFor="new-days">Hari</Label>
              <Input
                id="new-days"
                type="number"
                value={newDays}
                onChange={(e) => setNewDays(e.target.value)}
                disabled={busy}
                placeholder="hari"
              />
            </div>
          </div>
          {kindOptions.length === 0 && (
            <p className="mt-2 text-xs text-slate-500">
              Semua peran khusus (Awal/Menang/Kalah) sudah terisi. Tahap baru hanya bisa berperan biasa.
            </p>
          )}
          <div className="mt-3 flex justify-end">
            <Button onClick={addStage} disabled={busy || !newName.trim()}>
              Tambah
            </Button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
