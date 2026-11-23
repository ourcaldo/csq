// PRD 29 - the tenant permission catalog. One named key per enforced
// capability; roles store arrays of these keys. Every key MUST map to at
// least one enforced gate (requirePermission call site) - no dead
// permissions. Owner-only keys are never grantable to custom roles; they
// are checked with requireOwner().

export type PermissionKey = string;

export const OWNER_ONLY_KEYS: readonly PermissionKey[] = [
  "peran.kelola",
  "pengaturan.tim",
  "apikeys.kelola",
  "audit.lihat",
  "billing.lihat",
  "pengaturan.kelola",
];

export type PermissionGroup = {
  label: string;
  keys: { key: PermissionKey; label: string }[];
};

export const PERMISSION_GROUPS: readonly PermissionGroup[] = [
  {
    label: "Percakapan",
    keys: [
      { key: "inbox.lihat", label: "Lihat percakapan" },
      { key: "inbox.balas", label: "Kirim / balas pesan" },
      { key: "inbox.tugaskan", label: "Tugaskan percakapan" },
      { key: "inbox.catatan", label: "Catatan internal" },
      { key: "inbox.tag", label: "Labeli percakapan" },
      { key: "inbox.template_kirim", label: "Kirim template" },
      { key: "inbox.media", label: "Unggah media" },
    ],
  },
  {
    label: "Pipeline",
    keys: [
      { key: "pipeline.lihat", label: "Lihat pipeline" },
      { key: "pipeline.kelola", label: "Kelola pipeline" },
    ],
  },
  {
    label: "Kampanye",
    keys: [
      { key: "kampanye.lihat", label: "Lihat kampanye" },
      { key: "kampanye.kelola", label: "Kelola kampanye" },
    ],
  },
  {
    label: "Template Pesan",
    keys: [
      { key: "template.lihat", label: "Lihat template" },
      { key: "template.kelola", label: "Kelola template" },
    ],
  },
  {
    label: "Data Bisnis",
    keys: [
      { key: "produk.lihat", label: "Lihat produk" },
      { key: "produk.kelola", label: "Kelola produk" },
      { key: "inventaris.lihat", label: "Lihat inventaris" },
      { key: "inventaris.kelola", label: "Kelola inventaris" },
      { key: "pesanan.lihat", label: "Lihat pesanan" },
      { key: "pesanan.kelola", label: "Kelola pesanan" },
      { key: "kontak.lihat", label: "Lihat kontak" },
      { key: "kontak.kelola", label: "Kelola kontak" },
      { key: "tag.lihat", label: "Lihat tag" },
      { key: "tag.kelola", label: "Kelola tag" },
    ],
  },
  {
    label: "Pengetahuan",
    keys: [
      { key: "pengetahuan.kelola", label: "Kelola pengetahuan" },
      { key: "memori.lihat", label: "Lihat memori" },
      { key: "memori.kelola", label: "Kelola memori" },
      { key: "sumberdata.kelola", label: "Kelola sumber data" },
      { key: "impor.kelola", label: "Impor Excel / Sheets" },
    ],
  },
  {
    label: "Agent & Otomasi",
    keys: [
      { key: "agent.lihat", label: "Lihat agent" },
      { key: "agent.kelola", label: "Kelola agent" },
      { key: "skenario.lihat", label: "Lihat skenario" },
      { key: "skenario.kelola", label: "Kelola skenario" },
      { key: "approval.lihat", label: "Lihat approval" },
      { key: "approval.putuskan", label: "Setujui / tolak approval" },
      { key: "tiket.lihat", label: "Lihat tiket" },
      { key: "tiket.kelola", label: "Kelola tiket" },
    ],
  },
  {
    label: "Analitik",
    keys: [
      { key: "kpi.lihat", label: "Lihat KPI" },
      { key: "aktivitas.lihat", label: "Lihat aktivitas" },
    ],
  },
  {
    label: "Saluran",
    keys: [
      { key: "saluran.lihat", label: "Lihat saluran" },
      { key: "saluran.tambah", label: "Tambah saluran" },
      { key: "saluran.ubah", label: "Ubah saluran" },
      { key: "saluran.hapus", label: "Hapus saluran" },
    ],
  },
  {
    label: "Pengaturan",
    keys: [
      { key: "webhook.lihat", label: "Lihat webhook" },
    ],
  },
];

export const ALL_KEYS: readonly PermissionKey[] = PERMISSION_GROUPS.flatMap(
  (g) => g.keys.map((k) => k.key)
);

// Keys that imply their section's read access (kelola implies lihat).
const IMPLIED: Readonly<Record<string, PermissionKey>> = {
  "produk.kelola": "produk.lihat",
  "inventaris.kelola": "inventaris.lihat",
  "pesanan.kelola": "pesanan.lihat",
  "kontak.kelola": "kontak.lihat",
  "tag.kelola": "tag.lihat",
  "pipeline.kelola": "pipeline.lihat",
  "kampanye.kelola": "kampanye.lihat",
  "template.kelola": "template.lihat",
  "memori.kelola": "memori.lihat",
  "skenario.kelola": "skenario.lihat",
  "tiket.kelola": "tiket.lihat",
};

// Expand a stored permission set with the implied read keys.
export function expandPermissions(perms: readonly PermissionKey[]): Set<PermissionKey> {
  const set = new Set<PermissionKey>(perms);
  for (const p of perms) {
    const implied = IMPLIED[p];
    if (implied) set.add(implied);
  }
  return set;
}

// AKSES_PENUH: every catalog key except the owner-only list.
export const AKSES_PENUH_KEYS: readonly PermissionKey[] = ALL_KEYS.filter(
  (k) => !OWNER_ONLY_KEYS.includes(k)
);

// ADMIN_CHAT (PRD 29 section 4, owner decision 2026-11-23): FULL powers on
// the conversation surfaces - not read-only - plus aktivitas.lihat.
export const ADMIN_CHAT_KEYS: readonly PermissionKey[] = [
  "inbox.lihat",
  "inbox.balas",
  "inbox.tugaskan",
  "inbox.catatan",
  "inbox.tag",
  "inbox.template_kirim",
  "inbox.media",
  "kontak.kelola",
  "pipeline.kelola",
  "tiket.kelola",
  "template.kelola",
  "aktivitas.lihat",
];

// Role-editor presets (PRD 29 section 4.1): the Baca/Edit/Penuh radio.
// Owner-only keys are never included in any preset.
export const ROLE_PRESETS: Record<"baca" | "edit" | "penuh", readonly PermissionKey[]> = {
  baca: ALL_KEYS.filter((k) => k.endsWith(".lihat") && !OWNER_ONLY_KEYS.includes(k)),
  edit: AKSES_PENUH_KEYS,
  penuh: AKSES_PENUH_KEYS,
};

// System role names - seeded per tenant, not deletable/renamable.
export const ROLE_AKSES_PENUH = "Akses Penuh";
export const ROLE_ADMIN_CHAT = "Admin Chat";
