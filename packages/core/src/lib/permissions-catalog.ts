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

// PRD 29 section 4.1 (owner correction 2026-11-23): the level selector is
// PER-FEATURE. Each feature owns its key set; the Baca/Edit/Penuh levels
// map to explicit key sets below (penuh = the feature's full key set).
// Single-key features (baca/edit empty) degrade to a plain toggle.
// Design reference: docs/demo/enterprise_roles_permissions_rbac.html.
export type PermissionFeature = {
  key: string;
  label: string;
  group: string;
  desc: string;
  keys: readonly PermissionKey[];
  baca: readonly PermissionKey[];
  edit: readonly PermissionKey[];
};

export const PERMISSION_FEATURES: readonly PermissionFeature[] = [
  {
    key: "inbox",
    label: "Percakapan",
    group: "Percakapan",
    desc: "Manajemen kotak masuk pelanggan, balasan pesan, catatan internal, dan pengiriman media.",
    keys: ["inbox.lihat", "inbox.balas", "inbox.tugaskan", "inbox.catatan", "inbox.tag", "inbox.template_kirim", "inbox.media"],
    baca: ["inbox.lihat"],
    edit: ["inbox.lihat", "inbox.balas", "inbox.catatan", "inbox.tag"],
  },
  {
    key: "pipeline",
    label: "Pipeline",
    group: "Penjualan & Pesan",
    desc: "Pelacakan tahapan deal penjualan dan pergerakan prospek.",
    keys: ["pipeline.lihat", "pipeline.kelola"],
    baca: ["pipeline.lihat"],
    edit: ["pipeline.lihat", "pipeline.kelola"],
  },
  {
    key: "kampanye",
    label: "Kampanye",
    group: "Penjualan & Pesan",
    desc: "Penjadwalan dan eksekusi siaran pesan massal ke segmen pelanggan.",
    keys: ["kampanye.lihat", "kampanye.kelola"],
    baca: ["kampanye.lihat"],
    edit: ["kampanye.lihat", "kampanye.kelola"],
  },
  {
    key: "template",
    label: "Template Pesan",
    group: "Penjualan & Pesan",
    desc: "Pengelolaan template pesan terverifikasi untuk komunikasi cepat.",
    keys: ["template.lihat", "template.kelola"],
    baca: ["template.lihat"],
    edit: ["template.lihat", "template.kelola"],
  },
  {
    key: "produk",
    label: "Produk",
    group: "Data Bisnis",
    desc: "Katalog barang/jasa, harga, dan variasi SKU.",
    keys: ["produk.lihat", "produk.kelola"],
    baca: ["produk.lihat"],
    edit: ["produk.lihat", "produk.kelola"],
  },
  {
    key: "inventaris",
    label: "Inventaris",
    group: "Data Bisnis",
    desc: "Pemantauan ketersediaan stok gudang dan penyesuaian kuantitas.",
    keys: ["inventaris.lihat", "inventaris.kelola"],
    baca: ["inventaris.lihat"],
    edit: ["inventaris.lihat", "inventaris.kelola"],
  },
  {
    key: "pesanan",
    label: "Pesanan",
    group: "Data Bisnis",
    desc: "Pemrosesan transaksi pelanggan, status pembayaran, dan pemenuhan pesanan.",
    keys: ["pesanan.lihat", "pesanan.kelola"],
    baca: ["pesanan.lihat"],
    edit: ["pesanan.lihat", "pesanan.kelola"],
  },
  {
    key: "kontak",
    label: "Kontak",
    group: "Data Bisnis",
    desc: "Direktori profil pelanggan, atribut CRM, dan riwayat interaksi.",
    keys: ["kontak.lihat", "kontak.kelola"],
    baca: ["kontak.lihat"],
    edit: ["kontak.lihat", "kontak.kelola"],
  },
  {
    key: "tag",
    label: "Tag",
    group: "Data Bisnis",
    desc: "Taksonomi label untuk pengelompokan kontak dan percakapan.",
    keys: ["tag.lihat", "tag.kelola"],
    baca: ["tag.lihat"],
    edit: ["tag.lihat", "tag.kelola"],
  },
  {
    key: "pengetahuan",
    label: "Pengetahuan",
    group: "Pengetahuan",
    desc: "Basis pengetahuan dokumen dan FAQ yang digunakan oleh AI Agent.",
    keys: ["pengetahuan.kelola"],
    baca: [],
    edit: [],
  },
  {
    key: "memori",
    label: "Memori",
    group: "Pengetahuan",
    desc: "Konteks jangka panjang yang diingat AI Agent dari sesi pelanggan.",
    keys: ["memori.lihat", "memori.kelola"],
    baca: ["memori.lihat"],
    edit: ["memori.lihat", "memori.kelola"],
  },
  {
    key: "sumberdata",
    label: "Sumber Data",
    group: "Pengetahuan",
    desc: "Koneksi sinkronisasi dokumen eksternal dan crawler situs web.",
    keys: ["sumberdata.kelola"],
    baca: [],
    edit: [],
  },
  {
    key: "impor",
    label: "Impor Excel / Sheets",
    group: "Pengetahuan",
    desc: "Unggah massal data terstruktur melalui file spreadsheet.",
    keys: ["impor.kelola"],
    baca: [],
    edit: [],
  },
  {
    key: "agent",
    label: "Agent",
    group: "Agent & Otomasi",
    desc: "Konfigurasi persona AI Agent, instruksi sistem, dan parameter model.",
    keys: ["agent.lihat", "agent.kelola"],
    baca: ["agent.lihat"],
    edit: ["agent.lihat", "agent.kelola"],
  },
  {
    key: "skenario",
    label: "Skenario",
    group: "Agent & Otomasi",
    desc: "Alur kerja otomatis (workflow) berbasis pemicu dan kondisi.",
    keys: ["skenario.lihat", "skenario.kelola"],
    baca: ["skenario.lihat"],
    edit: ["skenario.lihat", "skenario.kelola"],
  },
  {
    key: "approval",
    label: "Approval",
    group: "Agent & Otomasi",
    desc: "Antrean persetujuan manusia (Human-in-the-Loop) sebelum aksi kritis dijalankan.",
    keys: ["approval.lihat", "approval.putuskan"],
    baca: ["approval.lihat"],
    edit: ["approval.lihat", "approval.putuskan"],
  },
  {
    key: "tiket",
    label: "Tiket",
    group: "Agent & Otomasi",
    desc: "Sistem eskalasi kendala pelanggan dengan pelacakan SLA.",
    keys: ["tiket.lihat", "tiket.kelola"],
    baca: ["tiket.lihat"],
    edit: ["tiket.lihat", "tiket.kelola"],
  },
  {
    key: "kpi",
    label: "KPI",
    group: "Analitik",
    desc: "Dasbor metrik performa operasional, waktu respons, dan konversi.",
    keys: ["kpi.lihat"],
    baca: [],
    edit: [],
  },
  {
    key: "aktivitas",
    label: "Aktivitas",
    group: "Analitik",
    desc: "Log aktivitas sistem dan pemantauan kinerja tim secara real-time.",
    keys: ["aktivitas.lihat"],
    baca: [],
    edit: [],
  },
  {
    key: "saluran",
    label: "Saluran",
    group: "Saluran",
    desc: "Integrasi akun WhatsApp dan saluran komunikasi lainnya.",
    keys: ["saluran.lihat", "saluran.tambah", "saluran.ubah", "saluran.hapus"],
    baca: ["saluran.lihat"],
    edit: ["saluran.lihat", "saluran.tambah", "saluran.ubah"],
  },
  {
    key: "webhook",
    label: "Webhook",
    group: "Saluran",
    desc: "Inspeksi endpoint webhook dan payload integrasi sistem eksternal.",
    keys: ["webhook.lihat"],
    baca: [],
    edit: [],
  },
];

// Display order of the feature groups.
export const FEATURE_GROUPS: readonly string[] = [
  "Percakapan",
  "Penjualan & Pesan",
  "Data Bisnis",
  "Pengetahuan",
  "Agent & Otomasi",
  "Analitik",
  "Saluran",
];

// Resolve a feature's current level from the active permission set.
// "kustom" = the set matches none of the levels, "off" = nothing granted.
export type FeatureLevel = "off" | "baca" | "edit" | "penuh" | "kustom";

export function featureLevel(feature: PermissionFeature, perms: Set<PermissionKey>): FeatureLevel {
  const granted = feature.keys.filter((k) => perms.has(k));
  if (granted.length === 0) return "off";
  if (granted.length === feature.keys.length) return "penuh";
  if (
    feature.edit.length > 0 &&
    feature.edit.every((k) => perms.has(k)) &&
    granted.every((k) => feature.edit.includes(k))
  ) {
    return "edit";
  }
  if (
    feature.baca.length > 0 &&
    feature.baca.every((k) => perms.has(k)) &&
    granted.every((k) => feature.baca.includes(k))
  ) {
    return "baca";
  }
  return "kustom";
}

// Apply a level to a feature: remove all the feature's keys, add the
// level's key set ("off" removes everything).
export function applyFeatureLevel(
  perms: Set<PermissionKey>,
  feature: PermissionFeature,
  level: "off" | "baca" | "edit" | "penuh"
): void {
  for (const k of feature.keys) perms.delete(k);
  const add =
    level === "penuh" ? feature.keys : level === "edit" ? feature.edit : level === "baca" ? feature.baca : [];
  for (const k of add) perms.add(k);
}

// System role names - seeded per tenant, not deletable/renamable.
export const ROLE_AKSES_PENUH = "Akses Penuh";
export const ROLE_ADMIN_CHAT = "Admin Chat";
