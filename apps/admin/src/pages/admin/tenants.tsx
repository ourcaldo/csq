import { type FormEvent, useState } from "react";
import Link from "next/link";
import { Plus, X } from "@phosphor-icons/react";
import { AdminShell } from "@/components/admin-shell";
import { Btn, PageHead, Status, TableCard, btnClass } from "@/components/console";
import { Dialog } from "@csq/ui/components/ui/dialog";
import { withAdminAuth } from "@/lib/admin-auth";
import { useAdminApi, adminFetch } from "@/lib/admin-api";
import { Input } from "@csq/ui/components/ui/input";
import { Label } from "@csq/ui/components/ui/label";
import { Select } from "@csq/ui/components/ui/select";

type Tenant = {
  id: string;
  name: string;
  slug: string;
  status: string;
  createdAt: string;
  userCount: number;
  channelCount: number;
  conversationCount: number;
  messageCount30d: number;
};
type TenantList = { items: Tenant[] };

const EMPTY_FORM = { name: "", ownerEmail: "", ownerName: "", ownerPassword: "" };

export const getServerSideProps = withAdminAuth(async () => ({ props: {} }));

export default function TenantsPage() {
  // ADM-2 (PRD 16): search + status filter. qInput buffers the text box so
  // typing does not refetch per keystroke; the list URL only changes on
  // submit (or when the status select changes).
  const [qInput, setQInput] = useState("");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  const qs = params.toString();
  const { data, loading, error, refresh } = useAdminApi<TenantList>(
    qs ? `/api/admin/tenants?${qs}` : "/api/admin/tenants"
  );
  const [showCreate, setShowCreate] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [createNotice, setCreateNotice] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);

  async function createTenant(e: FormEvent) {
    e.preventDefault();
    setBusy("create");
    setActionError(null);
    setCreateNotice(null);
    try {
      const r = await adminFetch<{
        id: string;
        name: string;
        slug: string;
        welcomeEmailSent: boolean;
      }>("/api/admin/tenants", "POST", form);
      setShowCreate(false);
      setForm(EMPTY_FORM);
      setCreateNotice(
        `Tenant dibuat. ID tenant: ${r.slug}. ` +
          (r.welcomeEmailSent
            ? "Email selamat datang (berisi kredensial login) terkirim ke pemiliknya."
            : "Email selamat datang TIDAK terkirim (SMTP platform belum diatur atau gagal) - serahkan email + password secara manual.")
      );
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal membuat tenant.");
    } finally {
      setBusy(null);
    }
  }

  async function toggleStatus(id: string, current: string) {
    setBusy(id);
    setActionError(null);
    try {
      await adminFetch(`/api/admin/tenants/${id}`, "POST", {
        action: current === "ACTIVE" ? "suspend" : "activate",
      });
      refresh();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Gagal mengubah status.");
    } finally {
      setBusy(null);
    }
  }

  const items = data?.items ?? [];

  return (
    <AdminShell title="Tenant">
      <PageHead
        eyebrow="Platform"
        title="Tenant"
        sub={`${items.length} tenant terdaftar`}
        action={
          <Btn onClick={() => setShowCreate(true)}>
            <Plus size={14} weight="bold" />
            Tenant baru
          </Btn>
        }
      />

      {(actionError || error) && (
        <div className="mb-4 rounded-xl border border-border border-l-2 border-l-bad bg-card px-5 py-3 text-[13px] text-bad">
          {actionError ?? error}
        </div>
      )}

      {createNotice && (
        <div className="mb-4 rounded-xl border border-border border-l-2 border-l-ok bg-card px-5 py-3 text-[13px] text-foreground">
          {createNotice}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setQ(qInput.trim());
        }}
        className="mb-4 flex flex-wrap items-center gap-2"
      >
        <Input
          value={qInput}
          onChange={(e) => setQInput(e.target.value)}
          placeholder="Cari nama atau slug"
          aria-label="Cari tenant"
          className="h-9 w-56"
        />
        <Select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filter status"
          className="h-9 w-40"
        >
          <option value="">Semua status</option>
          <option value="ACTIVE">Aktif</option>
          <option value="SUSPENDED">Ditangguhkan</option>
        </Select>
        <Btn type="submit" variant="line">
          Cari
        </Btn>
      </form>

      <TableCard>
        <table className="ledger">
          <thead>
            <tr>
              <th>Nama</th>
              <th>Status</th>
              <th>Kesehatan</th>
              <th className="text-right">Pengguna</th>
              <th className="text-right">Saluran</th>
              <th className="text-right">Percakapan</th>
              <th className="text-right">Pesan 30h</th>
              <th>Dibuat</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.id}>
                <td>
                  <div className="font-medium">{t.name}</div>
                  <div className="text-[12px] text-muted-foreground">{t.slug}</div>
                </td>
                <td>
                  <Status tone={t.status === "ACTIVE" ? "ok" : "bad"}>
                    {t.status === "ACTIVE" ? "Aktif" : "Ditangguhkan"}
                  </Status>
                </td>
                <td>
                  <Status tone={t.channelCount > 0 && t.messageCount30d > 0 ? "ok" : "off"}>
                    {t.channelCount > 0 && t.messageCount30d > 0 ? "Sehat" : "Diam"}
                  </Status>
                </td>
                <td className="text-right font-mono tabular-nums">{t.userCount}</td>
                <td className="text-right font-mono tabular-nums">{t.channelCount}</td>
                <td className="text-right font-mono tabular-nums">{t.conversationCount}</td>
                <td className="text-right font-mono tabular-nums">{t.messageCount30d}</td>
                <td className="whitespace-nowrap font-mono text-[12.5px] text-muted-foreground">
                  {new Date(t.createdAt).toLocaleDateString("id-ID", {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </td>
                <td className="text-right">
                  <Link
                    href={`/admin/tenants/${t.id}`}
                    className={`${btnClass("ghost")} mr-1`}
                  >
                    Detail
                  </Link>
                  <Btn
                    variant="ghost"
                    disabled={busy === t.id}
                    onClick={() => void toggleStatus(t.id, t.status)}
                    className={
                      t.status === "ACTIVE" ? "hover:text-bad" : "hover:text-primary"
                    }
                  >
                    {t.status === "ACTIVE" ? "Tangguhkan" : "Aktifkan"}
                  </Btn>
                </td>
              </tr>
            ))}
            {!loading && items.length === 0 && (
              <tr>
                <td colSpan={9} className="py-12 text-center text-[13px] text-muted-foreground">
                  Tidak ada tenant yang cocok.
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={9} className="py-12 text-center text-[13px] text-muted-foreground">
                  Memuat...
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableCard>

      <Dialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        ariaLabel="Tenant baru"
        className="max-w-lg rounded-2xl border-border bg-card p-0 shadow-[0_24px_64px_rgba(0,0,0,0.18)]"
      >
            <div className="flex items-start justify-between border-b border-border px-5 py-4">
              <div>
                <div className="eyebrow mb-1">Platform</div>
                <h2 className="text-[18px] font-semibold tracking-tight">Tenant baru</h2>
                <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                  Membuat tenant dan akun owner.
                </p>
              </div>
              <button
                onClick={() => setShowCreate(false)}
                className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                aria-label="Tutup"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={createTenant} className="space-y-4 p-5">
              <div className="space-y-1.5">
                <Label htmlFor="t-name">Nama tenant</Label>
                <Input
                  id="t-name"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Toko Kopi Nusantara"
                />
                <p className="text-[12px] text-muted-foreground">
                  ID tenant dibuat otomatis (alfanumerik, unik).
                </p>
              </div>

              <div className="border-t border-border pt-4">
                <div className="eyebrow mb-3">Akun owner</div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="t-email">Email</Label>
                    <Input
                      id="t-email"
                      type="email"
                      required
                      value={form.ownerEmail}
                      onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })}
                      placeholder="owner@tokokopi.id"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="t-oname">Nama</Label>
                    <Input
                      id="t-oname"
                      required
                      value={form.ownerName}
                      onChange={(e) => setForm({ ...form, ownerName: e.target.value })}
                      placeholder="Budi Santoso"
                    />
                  </div>
                </div>
                <div className="mt-3 space-y-1.5">
                  <Label htmlFor="t-pass">Password</Label>
                  <Input
                    id="t-pass"
                    type="password"
                    required
                    minLength={8}
                    value={form.ownerPassword}
                    onChange={(e) => setForm({ ...form, ownerPassword: e.target.value })}
                    placeholder="Minimal 8 karakter"
                  />
                </div>
              </div>

              {actionError && <p className="text-[13px] text-bad">{actionError}</p>}

              <div className="flex justify-end gap-2 pt-1">
                <Btn type="button" variant="line" onClick={() => setShowCreate(false)}>
                  Batal
                </Btn>
                <Btn type="submit" disabled={busy === "create"}>
                  {busy === "create" ? "Membuat..." : "Buat tenant"}
                </Btn>
              </div>
            </form>
      </Dialog>
    </AdminShell>
  );
}
