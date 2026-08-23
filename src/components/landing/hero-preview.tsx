// Hero visual: a static browser window showing the real CSQ inbox UI — the
// actual product, not a staged phone demo or animated chat. Sidebar nav,
// conversation list, and a chat thread that ends on the permission moment
// (agent quotes stock/price, then routes a price change to owner approval).
// Nothing animates; it reads like a screenshot.
import {
  ChatCircleDots,
  Kanban,
  Package,
  Books,
  Robot,
  DotsThreeVertical,
  MagnifyingGlass,
} from "@phosphor-icons/react";

export function HeroPreview() {
  return (
    <div className="w-full overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-slate-900/5">
      {/* Browser chrome */}
      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
        <span className="h-2.5 w-2.5 rounded-full bg-green-400" />
        <div className="mx-auto flex items-center gap-1.5 rounded-md bg-white px-3 py-1 text-[11px] text-slate-400 ring-1 ring-slate-200">
          <span className="h-2 w-2 rounded-full bg-green-500" />
          csq.id/dashboard/inbox
        </div>
      </div>

      {/* App body */}
      <div className="flex h-[380px] text-left">
        {/* Mini sidebar */}
        <aside className="hidden w-12 shrink-0 flex-col items-center gap-4 border-r border-slate-200 bg-white py-4 sm:flex">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-600 text-white">
            <ChatCircleDots size={18} weight="fill" />
          </span>
          <NavIcon icon={ChatCircleDots} active />
          <NavIcon icon={Kanban} />
          <NavIcon icon={Package} />
          <NavIcon icon={Books} />
          <NavIcon icon={Robot} />
        </aside>

        {/* Conversation list */}
        <div className="hidden w-48 shrink-0 border-r border-slate-200 bg-white md:block">
          <div className="flex items-center justify-between px-3 py-3">
            <span className="text-xs font-semibold text-slate-900">Percakapan</span>
            <MagnifyingGlass size={13} className="text-slate-400" />
          </div>
          <div className="space-y-1 px-2">
            <ConvRow name="Rina — Toko Kopi" preview="Bisa Rp50.000?" time="09:02" active />
            <ConvRow name="Dewi Catering" preview="Pesanan untuk sabtu" time="08:47" />
            <ConvRow name="Warung Bu Tini" preview="Ada kopi robusta?" time="Kmrn" />
            <ConvRow name="Toko Makmur" preview="Restock 20 pack" time="Kmrn" />
          </div>
        </div>

        {/* Chat panel */}
        <div className="flex min-w-0 flex-1 flex-col bg-slate-50/40">
          <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">Rina — Toko Kopi Nusantara</p>
              <p className="text-[10px] text-green-600">AI menangani</p>
            </div>
            <DotsThreeVertical size={16} className="text-slate-400" />
          </div>

          <div className="flex-1 space-y-2.5 p-4">
            <Bubble side="in">Kopi arabika 250g masih ada?</Bubble>
            <Bubble side="out">Masih ada — stok 12 pack, harga Rp85.000.</Bubble>
            <Bubble side="in">Bisa jual Rp50.000? Aku ambil 5 pack.</Bubble>
            <Bubble side="out" tag="Perlu izin owner">
              Mengubah harga di luar kebijakan saya. Permintaan diskon saya teruskan ke owner untuk disetujui.
            </Bubble>
          </div>
        </div>
      </div>
    </div>
  );
}

function NavIcon({ icon: Icon, active = false }: { icon: typeof ChatCircleDots; active?: boolean }) {
  return (
    <span
      className={
        "flex h-8 w-8 items-center justify-center rounded-lg " +
        (active ? "bg-slate-100 text-slate-900" : "text-slate-400")
      }
    >
      <Icon size={16} />
    </span>
  );
}

function ConvRow({ name, preview, time, active = false }: { name: string; preview: string; time: string; active?: boolean }) {
  return (
    <div className={"rounded-lg px-2.5 py-2 " + (active ? "bg-slate-100" : "hover:bg-slate-50")}>
      <div className="flex items-center justify-between">
        <p className="truncate text-[11px] font-semibold text-slate-900">{name}</p>
        <p className="shrink-0 text-[9px] text-slate-400">{time}</p>
      </div>
      <p className="truncate text-[10px] text-slate-500">{preview}</p>
    </div>
  );
}

function Bubble({ side, tag, children }: { side: "in" | "out"; tag?: string; children: React.ReactNode }) {
  const isIn = side === "in";
  return (
    <div className={`flex ${isIn ? "justify-start" : "justify-end"}`}>
      <div className="max-w-[80%]">
        {tag && (
          <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-medium text-amber-700">
            {tag}
          </span>
        )}
        <div
          className={
            "px-3 py-2 text-[11px] leading-relaxed " +
            (isIn
              ? "rounded-[1rem_1rem_1rem_0.25rem] bg-slate-100 text-slate-800"
              : "rounded-[1rem_1rem_0.25rem_1rem] bg-green-100 text-green-900")
          }
        >
          {children}
        </div>
      </div>
    </div>
  );
}
