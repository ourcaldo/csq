// PRD 29 section 6/6.1 - per-channel access panel on the Saluran page
// (owner-only). Lists the channel's grants (per role and/or per user) with
// LIHAT/KIRIM/KELOLA toggles and the loud KELOLA warning: a Baileys QR scan
// pairs the WhatsApp session to whoever scans it.
import { useEffect, useState } from "react";
import { Plus, Trash, Warning } from "@phosphor-icons/react";
import { apiSend } from "@/lib/api-client";
import { useApi } from "@/hooks/use-api";
import { cn } from "@csq/ui/lib/utils";

type Grant = {
  id: string;
  principal: "ROLE" | "USER";
  principalId: string;
  principalName: string;
  canView: boolean;
  canCompose: boolean;
  canManage: boolean;
};

type Option = { id: string; name: string };

export function ChannelAccessPanel({
  channelId,
  channelLabel,
  isBaileys,
}: {
  channelId: string;
  channelLabel: string;
  isBaileys: boolean;
}) {
  const { data, refresh } = useApi<{ items: Grant[] }>(
    `/api/dashboard/channels/${channelId}/access`
  );
  const teamApi = useApi<{
    items: { id: string; email: string; name: string | null; isOwner: boolean }[];
  }>("/api/dashboard/team?page=1&pageSize=100");
  const rolesApi = useApi<{ items: Option[] }>("/api/dashboard/roles");
  const members = (teamApi.data?.items ?? []).filter((m) => !m.isOwner);
  const roles = rolesApi.data?.items ?? [];

  const [grants, setGrants] = useState<Grant[]>([]);
  const [dirty, setDirty] = useState(false);
  const [pickKind, setPickKind] = useState<"ROLE" | "USER">("ROLE");
  const [pickId, setPickId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data?.items) setGrants(data.items);
  }, [data]);

  function updateGrant(idx: number, patch: Partial<Grant>) {
    setGrants((prev) => prev.map((g, i) => (i === idx ? { ...g, ...patch } : g)));
    setDirty(true);
  }

  function addGrant() {
    if (!pickId) return;
    if (grants.some((g) => g.principal === pickKind && g.principalId === pickId)) return;
    const name =
      pickKind === "ROLE"
        ? (roles.find((r) => r.id === pickId)?.name ?? "?")
        : (() => {
            const m = members.find((x) => x.id === pickId);
            return m?.name ?? m?.email ?? "?";
          })();
    setGrants((prev) => [
      ...prev,
      {
        id: `${pickKind}:${pickId}`,
        principal: pickKind,
        principalId: pickId,
        principalName: name,
        canView: true,
        canCompose: true,
        canManage: false,
      },
    ]);
    setPickId("");
    setDirty(true);
  }

  async function save() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await apiSend(`/api/dashboard/channels/${channelId}/access`, "PUT", {
        grants: grants.map((g) => ({
          principal: g.principal,
          principalId: g.principalId,
          canView: g.canView,
          canCompose: g.canCompose,
          canManage: g.canManage,
        })),
      });
      setDirty(false);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan akses.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-slate-900">
            Akses Saluran: {channelLabel}
          </p>
          <p className="mt-0.5 text-[11px] text-slate-500">
            Pemilik dan peran Akses Penuh selalu melihat semua saluran. Untuk
            lainnya, akses hanya berlaku jika diberikan di sini.
          </p>
        </div>
        {isBaileys && (
          <p className="flex max-w-xs items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-800">
            <Warning size={13} weight="fill" className="mt-0.5 shrink-0" />
            Kelola mencakup pindai QR / koneksi: pemegang kendali dapat
            mengarahkan sesi WhatsApp saluran ini ke perangkatnya sendiri.
          </p>
        )}
      </div>

      {grants.length > 0 && (
        <div className="mt-3 divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
          {grants.map((g, i) => (
            <div key={`${g.principal}:${g.principalId}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className={cn(
                    "rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase",
                    g.principal === "ROLE" ? "bg-green-50 text-green-700" : "bg-blue-50 text-blue-700"
                  )}
                >
                  {g.principal === "ROLE" ? "Peran" : "Anggota"}
                </span>
                <span className="truncate text-xs font-medium text-slate-800">
                  {g.principalName}
                </span>
              </div>
              <div className="flex items-center gap-3">
                {(
                  [
                    ["canView", "Lihat"],
                    ["canCompose", "Kirim"],
                    ["canManage", "Kelola"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-1 text-[11px] text-slate-600">
                    <input
                      type="checkbox"
                      checked={g[key]}
                      onChange={(e) => updateGrant(i, { [key]: e.target.checked })}
                      className="h-3 w-3 rounded border-slate-300 text-green-600 focus:ring-green-600"
                    />
                    {label}
                  </label>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setGrants((prev) => prev.filter((_, j) => j !== i));
                    setDirty(true);
                  }}
                  className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  aria-label="Hapus akses"
                >
                  <Trash size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {grants.length === 0 && (
        <p className="mt-3 rounded-md border border-dashed border-slate-300 px-3 py-4 text-center text-[11px] text-slate-400">
          Belum ada akses khusus - hanya pemilik dan Akses Penuh yang melihat
          saluran ini.
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <select
          value={pickKind}
          onChange={(e) => {
            setPickKind(e.target.value === "USER" ? "USER" : "ROLE");
            setPickId("");
          }}
          className="h-8 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-900"
        >
          <option value="ROLE">Peran</option>
          <option value="USER">Anggota</option>
        </select>
        <select
          value={pickId}
          onChange={(e) => setPickId(e.target.value)}
          className="h-8 min-w-40 rounded-md border border-slate-300 bg-white px-2 text-xs text-slate-900"
        >
          <option value="">
            {pickKind === "ROLE" ? "Pilih peran..." : "Pilih anggota..."}
          </option>
          {(pickKind === "ROLE" ? roles : members).map((o) => (
            <option key={o.id} value={o.id}>
              {"email" in o ? (o.name ?? o.email) : o.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={addGrant}
          disabled={!pickId}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          <Plus size={13} /> Beri Akses
        </button>
        <div className="flex-1" />
        {dirty && (
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="inline-flex h-8 items-center rounded-md bg-green-600 px-4 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-50"
          >
            {busy ? "Menyimpan..." : "Simpan Akses"}
          </button>
        )}
      </div>
      {error && <p className="mt-2 text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}
