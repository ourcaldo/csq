# Project Discussion — 2026-10-25

## About This File (read this first)

**What this is for:** `docs/*-project-discussion.md` files are the written record of significant product/architecture decisions and the reasoning behind them — discussions where we explored "should we build X?" and reached a conclusion. They exist so future sessions (and future us) don't re-litigate decisions or lose the *why* behind them. Commit history shows *what* changed; these files record *why we decided*.

**How to update:** When a discussion produces a real conclusion, create `docs/<YYYY-MM-DD>-project-discussion.md`. One file per date — if a file for today exists, append a new `## <topic>` section to it instead of making a new file. Write: the question, the options considered, the decision (or "deferred, revisit when <condition>"), and the reasoning. Keep it in plain language. These are decision records, not transcripts.

**Relationship to other docs:** PRD/SRS/SDD describe what to build; `Changelogs.md` records what shipped. These discussion files record the choices in between. If a decision changes what to build, the PRD should also be updated — the discussion file holds the reasoning, the PRD holds the requirement.

---

## Discussion 2: Inventory Stays a Separate Model (Not a Column on Product)

**Date:** 2026-10-25
**Status:** Decided — schema unchanged; Product = catalog, Inventory = stock level.

### The Question

The dashboard shows Product and Inventaris as two pages. Since Inventory is just "stock of the product," why isn't stock simply a column on Product?

### The Answer (verified in code)

- **Product** = catalog facts (name, description, SKU, price) — stable, one writer (the owner).
- **Inventory** = stock level — changes constantly, many writers (manual entry, Excel sync, Google Sheets sync, agent tool calls, order decrements).

The deciding reason: stock is the only field multiple sources fight over. The design keeps an `InventorySnapshot` row per (tenant, product, source) and resolves conflicts via the tenant's `sourcePriority` setting (`src/lib/source-priority.ts`, PRD §13 / G8). A plain column on Product could not record which source a number came from (`Inventory.source`/`sourceRef` provenance), so the latest sync would silently overwrite the owner's manual corrections — data loss with no audit trail.

Secondary reasons: separating them means stock syncs never touch catalog fields (a typo in an Excel price column can't rewrite your price), and the Tool Gateway's split permissions (`product.update` vs `inventory.update`) map exactly onto the two tables — which is what makes the demo-safety moment (agent may adjust stock but never price) enforceable.

Caveat recorded: if multi-source ingestion were ever dropped, a `stock` column would become defensible — but multi-source messy data is the core PRD pitch, so the separation stays. Dashboard UX may still present stock inline on the Product page later (presentation choice, not schema).

## Discussion 1: Multi-Agent — Keep, Don't Expand (Yet)

**Date:** 2026-10-25
**Status:** Decided — capability stays, single-agent focus for now, ops agent deferred to phase 2.

### The Question

Should the platform keep supporting multiple agents per tenant? Background: the multi-agent feature was originally requested so a second agent could exist alongside the default CS agent — one that only handles *operations* messages from the owner themselves (e.g. "ubah harga kopi jadi 25k", "stok susu sisa 5") sent from the owner's own phone to the same WhatsApp number. Customer messages trigger the CS agent; owner messages trigger the ops agent. Routing by *who sent the message*, not per channel.

### What Was Verified First

The multi-agent capability is already fully working in code — every piece exists and is production-tested with the demo tenant (just always with N=1 agent):

- `Agent` model: per-agent `instructions` (persona), `status`, per-agent rows.
- `AgentCapability` (`@@unique([agentId, tool])`): per-agent tool permissions, enforced by the Tool Gateway (`permissions.ts`). A new agent is born with zero capabilities and is inert until granted tools + deployed + wired to traffic.
- Routing: `agent-loop.ts` resolves conversation assignment → channel default agent.
- Per-conversation agent assignment exists in the inbox.

Creating a new agent today is harmless: it sits as a DRAFT doing nothing until explicitly wired. The only easy mistake: connecting the channel with a different default `agentId` — traffic silently moves to the new agent, which has no capabilities, so customers get refusals until tools are granted.

Missing piece for the original vision: **sender-based dispatch** (route by the sender's phone number). Today routing is by assignment/channel only.

### Options Considered

1. **Delete multi-agent capability, enforce one agent per tenant.** Rejected — deleting costs work and buys nothing: the unused capability has zero maintenance burden, enforcing a 1-agent cap is *more* code (validation, errors, UI hiding), and the phase-2 ops agent would need it rebuilt. The PRD (§6) also explicitly designs for multiple agents per tenant from day one.
2. **Build the owner-ops agent now (sender-based routing).** Deferred. The idea is legitimate and the market need is real — UMKM owners run the shop from their phone and won't open a dashboard to update stock; "WhatsApp as admin panel" may be the strongest feature for this segment. But:
   - **Security model is the hard part.** Phone number as the only auth for write operations is weak: SIM swap, number recycling, or a lost phone means someone else can rewrite prices and drain stock records. It also creates a path where a *message* triggers price changes — the protection is only "sender number matches a list," which threatens the sacred demo-safety principle ("a customer message can NEVER trigger an unauthorized price change"). Approvals don't help when requester and approver are the same owner.
   - **The runtime was just replaced** (OpenClaw → direct OpenAI-compatible, today). The CS agent chain is unproven in the field. A second agent doubles the testing surface before the first one is validated with real stores.
   - **Cost of waiting is near zero** — the schema already supports N agents; sender-based dispatch later is a small change in `agent-loop.ts` plus a security design.
3. **Keep the capability, focus on one CS agent, revisit ops agent as phase 2.** **Chosen.**

### The Decision

- Multi-agent capability **stays** in schema and UI. No deletion, no 1-agent cap.
- Product focus: **one CS agent**, deployed and proven with real stores.
- Phase-2 milestone: the **owner-ops agent**, gated on a proper security design first: explicit owner-phone allowlist (owner-configured, never inferred from conversation content), confirmation loop for writes ("Ubah harga Kopi Susu 18k→25k? Balas YA"), full audit, and consider a daily cap/threshold for high-impact writes.
- Agent type enum stays single-valued (`CUSTOMER_SERVICE`); the ops agent will just be another row with different instructions + write capabilities. No special platform work needed.

### Known Caveats Recorded

- Two ACTIVE agents on one channel: unassigned conversations always go to the channel default. No automatic intent-based dispatch (by design — PRD excludes multi-agent collaboration).
- History replay (the bounded 1h-window transcript) is conversation-scoped, not agent-scoped. Swapping agents mid-conversation shares the same window. Acceptable within current scope.
