// Coded CSQ inbox preview for the hero (a real component preview of the
// product, not a fake screenshot and not a staged phone). Frosted-glass frame
// wrapping the actual inbox layout: mini sidebar, conversation list, and a
// chat thread that ends on the permission moment (agent quotes stock/price,
// then routes a price change to owner approval). Static, pointer-events-none.
import {
  ChatCircleDots,
  Kanban,
  Package,
  Books,
  Robot,
  DotsThreeVertical,
  MagnifyingGlass,
  ShieldCheck,
} from "@phosphor-icons/react";

export function DashboardPreview() {
  return (
    <div className="liquid-glass w-full max-w-5xl overflow-hidden rounded-2xl p-2 sm:p-3">
      <div className="flex h-[240px] overflow-hidden rounded-xl bg-white md:h-[360px]">
        {/* Mini sidebar */}
        <aside className="hidden w-12 shrink-0 flex-col items-center gap-3 border-r border-slate-200 bg-white py-4 sm:flex">
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
            <ConvRow name="Rina - Toko Kopi" preview="Bisa Rp50.000?" time="09:02" active />
            <ConvRow name="Dewi Catering" preview="Pesanan sabtu" time="08:47" />
            <ConvRow name="Warung Bu Tini" preview="Ada kopi robusta?" time="Kmrn" />
          </div>
        </div>

        {/* Chat panel */}
        <div className="flex min-w-0 flex-1 flex-col bg-slate-50/50">
          <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-900">Rina - Toko Kopi Nusantara</p>
              <p className="text-[10px] font-medium text-green-600">AI menangani</p>
            </div>
            <DotsThreeVertical size={16} className="text-slate-400" />
          </div>
          <div className="flex-1 space-y-2.5 p-4">
            <Bubble side="in">Kopi arabika 250g masih ada?</Bubble>
            <Bubble side="out">Masih ada - stok 12 pack, harga Rp85.000.</Bubble>
            <Bubble side="in">Bisa jual Rp50.000? Ambil 5 pack.</Bubble>
            <Bubble side="out" tag="Perlu izin owner">
              Mengubah harga di luar kebijakan saya. Permintaan diskon saya teruskan ke owner.
            </Bubble>
          </div>
          <div className="flex items-center gap-2 border-t border-slate-200 bg-white px-3 py-2.5">
            <div className="flex-1 rounded-full bg-slate-100 px-3 py-1.5 text-[11px] text-slate-400">Ketik pesan...</div>
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-green-600 text-white">
              <ShieldCheck size={13} weight="fill" />
            </span>
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
    <div className={"rounded-lg px-2.5 py-2 " + (active ? "bg-slate-100" : "")}>
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
      <div className="max-w-[82%]">
        {tag && (
          <span className="mb-1 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[9px] font-medium text-amber-700">
            <ShieldCheck size={10} weight="fill" /> {tag}
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
