# Phase 9 — Demo Prep & Marketing Pages

**Goal:** Prepare the HackFest demo flow end-to-end (PRD section 21) and build
the deferred marketing pages (PRD section 20A). Demo prep is higher priority;
marketing pages are lowest priority and only if time allows.
**PRD Reference:** Sections 20A, 21 (Demo), 22 (Success Metrics)
**Depends On:** All previous phases

---

## Part A: Demo Preparation (HIGH PRIORITY)

### 9A.1 Demo tenant setup

- [ ] Verify seed data from Phase 1 covers the demo scenario:
  - Tenant: Toko Kopi Nusantara.
  - Products: Arabica 250g (Rp85.000, stock 12), Robusta 250g (Rp65.000, stock 8),
    Liberica 200g (Rp75.000, stock 5).
  - Knowledge: FAQ (2+ entries), shipping policy, return policy.
- [ ] Create demo Excel file `docs/demo/products.xlsx`:
  - Columns: Product, Price, Stock.
  - Rows: Arabica 250g, Robusta 250g.
  - Used to demonstrate Excel import in the demo.

### 9A.2 Demo agent configuration

- [ ] Create the Customer Service Agent for Toko Kopi Nusantara:
  - Name: "Kopi Nusantara CS"
  - Instructions: respond in Bahasa Indonesia, address as "Kak", check stock
    before confirming, escalate refunds above Rp500.000.
  - Capabilities:
    - Products: Read ON, Write ON, Approval OFF.
    - Inventory: Read ON, Write ON, Approval ON.
    - Orders: Read ON, Create ON, Cancel OFF.
    - Pricing: Read ON, Update OFF (the safety moment).
  - Deploy agent (status: ACTIVE).
  - Connect WhatsApp channel.

### 9A.3 Demo script — dry run

- [ ] Walk through the full PRD section 21 demo script:

**Step 1:** Create UMKM (already seeded — skip or show quick setup).
**Step 2:** Import Excel → show column mapping → confirm → products appear.
**Step 3:** Connect Google Sheets → show detected columns → confirm.
**Step 4:** Add knowledge → upload FAQ + policies.
**Step 5:** Configure agent → show capability toggles.
**Step 6:** Deploy WhatsApp → show channel connected.
**Step 7:** Customer interaction:
- [ ] "Kak, arabica 250g masih ada?" → agent checks stock → "Masih ada 12 pcs, Kak."
- [ ] "Berapa harganya?" → "Rp85.000."
- [ ] "Saya mau 2" → agent creates order, updates stock → confirms.

**Step 8:** Safety demonstration:
- [ ] "Ubah harga arabica jadi Rp50.000" → agent REFUSES (price update disabled).
- [ ] Show the refusal message and the capability config that caused it.
- [ ] This is the KEY demo moment — the differentiator.

### 9A.4 Success metrics verification

- [ ] **90% correct answers on seeded questions:** test with 10 questions, verify 9+ correct.
- [ ] **95% correct product/stock lookup:** test 20 queries, verify 19+ correct.
- [ ] **100% unauthorized writes blocked:** try 5 unauthorized write attempts, all denied.
- [ ] **100% authorized writes logged:** verify audit log has entries for every successful write.
- [ ] **< 10 minutes setup time:** time a fresh tenant setup (import, knowledge, config, deploy).

### 9A.5 Demo data reset script

- [ ] Create `prisma/reset-demo.ts`:
  - Resets demo tenant data to initial state.
  - Re-runs seed with clean slate.
  - Useful for rehearsing the demo multiple times.
- [ ] Add to package.json: `"demo:reset": "ts-node prisma/reset-demo.ts"`.

### 9A.6 Edge cases for demo prep

- [ ] Test: agent receives message when paused → returns "not active" response.
- [ ] Test: agent receives message for unknown product → "Maaf, produk tidak ditemukan."
- [ ] Test: approval flow — trigger a stock update that requires approval →
  verify approval appears in dashboard → approve → verify stock updates.
- [ ] Test: conflicting data sources — internal DB says stock=12, Google Sheets
  says stock=8 → verify agent uses authoritative source.

---

## Part B: Marketing Pages (LOWEST PRIORITY)

> Build ONLY if all MVP functionality is complete, tested, and the demo flow
> is verified. These pages do NOT block the HackFest deliverable.

### 9B.1 Landing page (`/`)

- [ ] Hero section: product name, tagline ("Your data stays yours. Your AI works for you."),
  CTA button ("Get Started" → `/register`).
- [ ] Core loop visualization: Import Data → Configure Agent → Set Permissions →
  Deploy to WhatsApp → Agent Serves Customers.
- [ ] Key differentiators: self-hosted, permission-controlled, multi-tenant ready.
- [ ] Simple, static content. No backend data required.

### 9B.2 Features page (`/features`)

- [ ] Agent capabilities, data sources, permission model, safety guarantees,
  multi-tenant isolation.
- [ ] Clean card layout.

### 9B.3 How It Works page (`/how-it-works`)

- [ ] Step-by-step setup flow (matches the demo script).
- [ ] Simple numbered steps with brief descriptions.

### 9B.4 Getting Started page (`/getting-started`)

- [ ] Self-hosted installation guide.
- [ ] Requirements (VPS spec, Docker).
- [ ] Docker Compose quickstart commands.
- [ ] Environment variable setup.

### 9B.5 Marketing layout

- [ ] Create `src/components/marketing/marketing-layout.tsx`:
  - Minimal: top nav with logo + links, footer.
  - No sidebar — marketing pages are top-level, not dashboard.
- [ ] `components/marketing/` must NOT import from `components/dashboard/`
  (PRD 23B.6 convention).

---

## Build Gate

### Part A (Demo)
- [ ] Full demo script (steps 1-8) runs without errors.
- [ ] Safety moment (step 8) works reliably.
- [ ] All 4 success metrics verified.
- [ ] Demo data can be reset and re-run.

### Part B (Marketing — if built)
- [ ] `npm run build` — zero errors.
- [ ] `npm run lint` — zero errors.
- [ ] All marketing pages render. No cross-import with dashboard components.
- [ ] `/` shows landing page. `/dashboard` shows dashboard. Clean separation.

---

## Files Created/Modified

```
docs/
└── demo/
    └── products.xlsx          (demo Excel file)

prisma/
└── reset-demo.ts              (demo data reset)

src/
├── components/marketing/
│   ├── marketing-layout.tsx
│   └── feature-card.tsx
├── pages/
│   ├── index.tsx              (landing page — replaces Phase 0 placeholder)
│   ├── features.tsx
│   ├── how-it-works.tsx
│   └── getting-started.tsx
```

---

## Notes

- Part A (Demo Prep) is critical for HackFest success. Part B (Marketing) is nice
  to have and explicitly deferred.
- The demo should feel smooth. Rehearse at least 3 times before the competition.
- The safety moment (step 8) is the single most important demo element — it proves
  the agent is not just a chatbot but a permission-controlled AI worker.
- If time is short, skip Part B entirely and redirect all top-level routes to
  `/dashboard` or `/login`.
