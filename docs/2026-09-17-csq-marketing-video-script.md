# CSQ — Marketing Video Script (60s)

**Project:** CSQ — AI Agent Platform untuk UMKM Indonesia
**Deliverable:** Naskah video pemasaran, 55–60 detik (versi 30s cut-down disertakan di bawah)
**Language/Tone:** Bahasa Indonesia, semi-formal, friendly — "kamu", sapaan hangat, kalimat pendek.
**Channel targets:** Landing page hero, YouTube, demo HackFest. Master 16:9; lihat catatan 9:16.
**Status:** Naskah v1 — untuk produksi HyperFrames (flow & copy final; visual spec siap dijadikan storyboard).

---

## Global Production Notes

### Voice Over direction
- **Pace:** ~3 kata/detik. Total naskah VO ≈ 170 kata → ~57 detik. Jangan buru-buru di scene 2 (problem) dan 7 (CTA).
- **Karakter suara:** Ramah, peduli, seperti teman yang paham bisnis. Scene 1–2: nada empati/kenalan. Scene 3–6: nada antusias meyakinkan. Scene 7: ajakan hangat, senyum terdengar.
- **Pengucapan:** "CSQ" dibaca per huruf "C-S-Q". "AI" dibaca "é-ai".
- Sisakan **jeda napas 0,3–0,5s** antar scene; jangan overlap dengan SFX transisi.

### Visual system
- **Frame:** Mock UI gaya WhatsApp (scene 1–2) → transisi ke **screen recording / mockup dashboard CSQ asli** (scene 3–6). Prioritaskan UI asli CSQ (repositori: `src/pages/dashboard/*`) supaya klaim terbukti, bukan janji.
- **Warna brand:** Hijau CSQ (mengikuti landing `src/pages/index.tsx` — hijau cover hero) + putih. Chat bubble WhatsApp: hijau WA untuk inbound, biru untuk AI agent (konsisten dengan inbox CSQ: AGENT = biru + badge robot).
- **Text-on-screen (super/kinetic):** Max 6 kata per super, muncul 1–2 kata sinkron dengan VO. Font sans-serif bold, kontras tinggi.
- **Aspect ratio:** Master 16:9. Untuk 9:16 (Reels/TikTok/Shorts): komposisikan semua elemen penting di safe area tengah; label "100+ chat/hari" dan CTA harus tetap terbaca setelah crop.

### Music & SFX
- **Music:** Upbeat corporate-pop light, 100–110 BPM, tanpa lirik. Intro problem (scene 1–2) lebih minim/beat lampau → build up di scene 3 → full energy scene 5–6 → soft out ke CTA.
- **SFX standar:** whoosh (transisi scene), pop (chat masuk), tick-up counter (angka stok/notif), "ting" (transfer sukses), swoosh (QR scan). Jangan berlebihan — max 1 SFX per 2 detik.

---

## Storyboard

### SCENE 1 — Hook: WhatsApp itu Bisnis (0:00 – 0:07)

| | |
|---|---|
| **VO** | "Di Indonesia, WhatsApp bukan cuma buat chat pribadi — tapi juga buat bisnis. Kalau kamu pemilik online shop atau toko kecil-menengah, CSQ paham tantangannya." |
| **On-screen text** | "WhatsApp = alat bisnis" → "CSQ paham." |
| **Visual** | Open shot: mock chat WhatsApp pribadi (chat keluarga, stiker) → kamera pull-back, chat list berubah jadi chat bisnis: "Kak, masih ada?" (toko baju), "Bisa cod?" (toko kopi), "Harga grosir?" (distro). Teks bubble khas pelanggan UMKM Indonesia. |
| **Animasi** | Chat list slide-up satu per satu (pop-in 150ms stagger), lalu freeze saat VO "CSQ paham tantangannya" → super text muncul. |
| **SFX** | Notif chat masuk (2×), halus. |
| **Transisi keluar** | Whoosh + kamera zoom ke satu chat — lanjut Scene 2. |

---

### SCENE 2 — Problem: Chat Banjir + Batasan Device (0:07 – 0:16)

| | |
|---|---|
| **VO** | "Awalnya sih mudah. Tapi bayangkan CS kamu harus handle ratusan chat tiap hari — ribet, kan? Belum lagi: satu nomor cuma bisa aktif di satu HP utama, plus maksimal empat perangkat tertaut." |
| **On-screen text** | "100+ chat/hari" (counter naik) → "1 HP utama + max 4 perangkat" (icon lock) |
| **Visual** | Layar HP mock: notifikasi chat masuk bertubi-tubi, badge unread counter naik cepat 1 → 27 → 100+ (tick-up counter). Layar mulai penuh sesak. Lalu cut ke diagram: 1 icon HP (utama, label "HP utama") terhubung garis ke max 4 icon device; device ke-5 muncul → tanda silah merah + shake. |
| **Animasi** | Chat notification pop-in mempercepat (stagger 150ms → 60ms) untuk efek overwhelm. Counter tick-up sync dengan VO "ratusan chat". Shake 3 frame saat device ke-5 ditolak. |
| **SFX** | Notifikasi beruntun (pitch naik), lalu "buzz" negatif pendek untuk device ditolak. |
| **Catatan riset** | Angka resmi: WhatsApp hanya mengizinkan **1 HP utama + maksimal 4 perangkat tertaut** (WhatsApp Help Center, faq.whatsapp.com/378279804439436). Perangkat tertaut logout otomatis bila HP utama tidak aktif 14 hari. Angka ini bisa dipakai sebagai super kecil untuk kredibilitas bila perlu. |
| **Transisi keluar** | Beat henti 0.3s (masalah menggantung) → whoosh naik + layar jadi bersih putih → Scene 3. |

---

### SCENE 3 — Solusi: AI Agent + Knowledge (0:16 – 0:24)

| | |
|---|---|
| **VO** | "Tenang — CSQ jawabannya. AI Agent CSQ otomatis menjawab klien sesuai informasi toko kamu — mulai produk, retur dan refund, sampai handle order." |
| **On-screen text** | "CSQ" (logo reveal) → "Tahu bisnismu: Produk · Retur & Refund · Order" |
| **Visual** | Logo CSQ muncul di tengah layar bersih. Lalu split-screen: kiri = dashboard knowledge CSQ (entri FAQ/POLICY), kanan = bubble chat klien "Bisa return kalau nggak cocok?" → AI agent jawab akurat mengutip kebijakan retur. Overlay 3 kartu kecil bergambar: produk (katalog), retur/refund (dokumen), order (keranjang). |
| **Animasi** | Entri knowledge "masuk" ke otak AI (garis mengalir dari kartu knowledge ke bubble jawaban) — pesan visual: "AI menjawab dari data toko kamu, bukan ngarang". Bubble AI ketik → kirim, badge robot biru. |
| **SFX** | Build-up musik dimulai. "Ding" saat AI menjawab. |
| **Transisi keluar** | Kartu knowledge fly-out, bubble chat tetap → Scene 4. |

---

### SCENE 4 — Handoff: AI → Human (0:24 – 0:32)

| | |
|---|---|
| **VO** | "Kalau klien butuh bantuan lebih lanjut? AI agent tinggal transfer ke CS kamu. CS fokus di kasus spesifik — AI lanjut melayani klien lainnya." |
| **On-screen text** | "Transfer ke CS manusia" → "CS fokus, AI jalan terus" |
| **Visual** | Inbox CSQ asli (3-pane dari `src/pages/dashboard/inbox`): bubble klien "Saya mau komplain pesanan" → tombol "Serahkan/Handoff" → bubble berpindah ke panel CS manusia (avatar CS). Di sampingnya secara paralel: tab conversation lain tetap bergerak, AI terus menjawab klien lain (2 bubble AI terkirim berurutan). |
| **Animasi** | Panah lembut dari bubble chat ke avatar CS ("ting" transfer). Untuk memperlihatkan paralel: panel kanan tetap hidup (bubble AI pop-in berkelanjutan) sementara CS membuka satu chat — kontras "satu CS = satu kasus, AI = semua sisanya". |
| **SFX** | "Ting" transfer. Pop bubble AI di background. |
| **Transisi keluar** | Whoosh, layar inbox shrink → Scene 5. |

---

### SCENE 5 — Freedom Device: Business API atau QR (0:32 – 0:43)

| | |
|---|---|
| **VO** | "Nggak perlu pusing soal device. Lewat WhatsApp Business API, semua CS bisa melayani dari dashboard CSQ di device apa pun. Belum punya API? Scan QR sekali — dan tara… CSQ siap dipakai." |
| **On-screen text** | "WhatsApp Business API" → "atau" → "Scan QR — selesai" |
| **Visual** | Halaman **Saluran** CSQ (`/dashboard/saluran`): dua kartu pilihan — "WhatsApp Resmi" dan "Bawa Nomor Sendiri". Path A: form Cloud API terisi → dashboard terbuka di 3 device sekaligus (laptop CS 1, tablet CS 2, HP owner) dengan chat yang sama. Path B: tampilkan QR besar, kursor/hands memindai dengan HP → status berubah "Terhubung". |
| **Animasi** | Split sequential: kartu API dulu (0:32–0:38), lalu kartu QR (0:38–0:43). Saat QR discan: efek scan-line hijau melintasi QR → checklist hijau → confetti mini "tara". Penekanan: **satu scan, semua CS akses via browser** — tampilkan 3 device dengan badge chat yang sama tersinkron. |
| **SFX** | Whoosh antar path. "Beep" scan QR → chime sukses. |
| **Catatan akurasi** | Jangan klaim "tanpa batas device" untuk jalur QR — QR pairing memakai slot perangkat tertaut WhatsApp. Frasa yang benar dan tetap menjual: "Scan QR sekali — semua CS melayani lewat dashboard CSQ." (Owner scan sekali; staf akses via browser.) |
| **Transisi keluar** | Dashboard di 3 device morph menjadi 1 layar utama → Scene 6. |

---

### SCENE 6 — Fitur: Stok Otomatis + Pipeline (0:43 – 0:52)

| | |
|---|---|
| **VO** | "Oh ya, CSQ juga bisa atur produk, varian, dan stok. Ada yang order? Stok berkurang otomatis. Ada pipeline buat lihat perjalanan klien — dari baru kenal sampai deal." |
| **On-screen text** | "Stok: 12 → 10 otomatis" → "Pipeline: Baru → Deal" |
| **Visual** | Dua shot berurutan: (1) Halaman Products/Inventory CSQ — kartu produk "Kopi Arabica", stok **12**; bubble order masuk "Order 2 ya kak" → angka stok tick turun ke **10** dengan animasi counter. (2) Halaman Pipeline CSQ — kanban 6 kolom (Baru → Menang), kartu deal berpindah kolom per kolom hingga kolom Menang (hijau). |
| **Animasi** | Counter stok: angka flip ke bawah saat order terkonfirmasi (sync VO "berkurang otomatis"). Kartu pipeline: drag lewat tiap kolom dengan trail lembut; saat masuk "Menang" → kilau hijau + badge "Deal". |
| **SFX** | Tick-turun counter. Swish per pindah kolom, chime di "Deal". Musim full-energy. |
| **Transisi keluar** | Seluruh UI panels fly-out ke tengah → Scene 7. |

---

### SCENE 7 — CTA (0:52 – 0:60)

| | |
|---|---|
| **VO** | "Jadi… sudah yakin kamu butuh CSQ? Yuk — pelajari dan coba CSQ sekarang!" |
| **On-screen text** | "CSQ — AI Agent untuk bisnismu" → tombol "Coba Sekarang" → URL |
| **Visual** | Background hijau CSQ bersih. Logo CSQ besar di tengah, di bawahnya 3 micro-icon yang sudah muncul sepanjang video (chat AI, handoff, pipeline) sebagai ringkasan visual. Tombol CTA "Coba Sekarang" muncul dengan spring pop. URL/QR kecil di pojok untuk versi offline demo. |
| **Animasi** | VO "Jadi…" → logo scale-in. "Coba CSQ sekarang" → tombol spring + micro-glow pulse 2× (ajakan klik). Music soft-out di detik terakhir. |
| **SFX** | Chime akhir hangat. |
| **Transisi keluar** | Fade to logo hold 0.5s → end. |

---

## Duration Budget (sanity check)

| Scene | Konten | Durasi kumulatif |
|---|---|---|
| 1 | Hook problem | 0–7s |
| 2 | Chat banjir + device limit | 7–16s |
| 3 | AI Agent + knowledge | 16–24s |
| 4 | Handoff human | 24–32s |
| 5 | API / QR freedom | 32–43s |
| 6 | Stok + pipeline | 43–52s |
| 7 | CTA | 52–60s |

Total VO ≈ 170 kata @ ~3 kata/detik ≈ **57s** + jeda = **60s** target. Jika hasil rekaman >60s, prioritas trim: Scene 5 frasa "di device apa pun" → "dari mana saja"; Scene 1 sapaan dipendekkan.

---

## Versi 30 Detik (Cut-down untuk Ads/Reels)

Scene yang dipertahankan: **2 → 3 → 5 → 7** (problem → solusi → device freedom → CTA).

| Scene | VO (30s cut) |
|---|---|
| 2 (0–6s) | "CS kamu harus handle ratusan chat tiap hari — ribet. Satu nomor WhatsApp pun cuma bisa di satu HP plus empat perangkat." |
| 3 (6–14s) | "CSQ jawabannya — AI Agent otomatis jawab klien sesuai data toko kamu: produk, refund, sampai order." |
| 5 (14–24s) | "Semua CS bisa melayani dari device mana pun via dashboard CSQ. Belum punya API? Scan QR sekali — selesai." |
| 7 (24–30s) | "Yuk, coba CSQ sekarang!" |

≈ 65 kata ≈ 25–27s + jeda = **30s**. Scene 4 dan 6 cukup jadi flash montage 1s di akhir Scene 5 bila ingin fitur tetap terlihat.

---

## Asset Checklist (untuk produksi HyperFrames)

| Asset | Sumber | Kondisi |
|---|---|---|
| Mock chat WhatsApp (bubble pelanggan UMKM) | Buat baru (HTML/CSS mock) | Copy chat: "Kak, masih ada?", "Bisa cod?", "Bisa return?", "Order 2 ya kak" |
| Dashboard knowledge CSQ | Screen record `/dashboard/knowledge` | Seeding entri FAQ/POLICY demo |
| Inbox CSQ (handoff) | Screen record `/dashboard/inbox` | Siapkan 2–3 conversation demo, 1 transaksi handoff |
| Saluran wizard (2 kartu + QR) | Screen record `/dashboard/saluran` | QR dummy (jangan QR asli akun demo) |
| Products/Inventory + counter stok | Screen record `/dashboard/inventory` | Produk Kopi Arabica stok 12 |
| Pipeline kanban | Screen record `/dashboard/pipeline` | Deal dummy di beberapa kolom |
| Logo CSQ + warna brand | `public/icon.svg`, styling landing `src/pages/index.tsx` | Ekstrak hex hijau utama |
| Icon set (HP, device, lock, produk, keranjang) | Phosphor (sudah ada di repo: `@phosphor-icons/react`) | Konsisten stroke/besaran |

## Catatan Penulis (perubahan dari draft → alasan)

1. **Draft VO asli ±250+ kata** → dipangkas ke ±170 kata. VO draft kalau dibacakan penuh 80–90 detik, melewati batas 60s. Frasa kunci dan urutan argumen dipertahankan; kata perangkap ("bayangkan kalau…", "oh ya, ngga perlu khawatir") dirampingkan.
2. **Angka device divalidasi**: "maksimal X device paired" dikunci ke **4 perangkat tertaut + 1 HP utama** berdasarkan WhatsApp Help Center resmi (faq.whatsapp.com/378279804439436). Super kecil "max 4 perangkat" bisa ditambahkan di Scene 2 untuk kredibilitas.
3. **Klaim Scene 5 dilunakkan**: "semua CS dari semua device tanpa device restriction" hanya sepenuhnya akurat untuk jalur Business API. Untuk jalur QR, frasa diubah jadi "scan QR sekali — semua CS melayani lewat dashboard" (owner scan 1×, staf akses via browser). Menjual, tetap benar.
4. **Urutan CTA dijaga dua langkah** sesuai draft: "pelajari dan coba" — cocok untuk produk HackFest yang masih fase demo.
5. Scene dibagi per 7–10 detik — batas nyaman retensi untuk video explainer 60s.
