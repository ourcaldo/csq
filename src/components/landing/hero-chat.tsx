// Hero signature: a WhatsApp-style chat that types itself out, live. It plays
// the product's sacred "demo safety moment" — a customer asks for a price, the
// agent quotes from the business's data, the customer demands a discount, and
// the agent refuses because changing prices needs owner approval. That single
// exchange is the whole thesis: read by default, write by permission.
//
// Motion no-ops under prefers-reduced-motion (all messages render statically).
// The script is also written into an sr-only block so screen readers and
// crawlers get the full content regardless of animation state.
import { useEffect, useRef, useState } from "react";
import { Robot, ShieldCheck, DotsThree, PaperPlaneRight } from "@phosphor-icons/react";

type Side = "in" | "out" | "approval";
type Msg = { side: Side; text: string };

const SCRIPT: Msg[] = [
  { side: "in", text: "Halo, kopi arabika 250g masih ada?" },
  { side: "out", text: "Halo! Masih ada — stok 12 pack, harga Rp85.000." },
  { side: "in", text: "Bisa jual Rp50.000? Aku ambil 5 pack." },
  {
    side: "out",
    text: "Maaf, mengubah harga di luar kebijakan saya. Permintaan diskon saya teruskan ke pemilik untuk disetujui.",
  },
  { side: "approval", text: "Permintaan diskon · menunggu persetujuan owner" },
  { side: "in", text: "Baik, aku tunggu kabar ya." },
  { side: "out", text: "Tentu — saya kabari segera setelah owner menyetujui. Ada yang lain?" },
];

const TYPE_MS = 16;
const SPACE_MS = 30;
const INDICATOR_MS = 620;
const GAP_MS = 820;
const LOOP_MS = 4400;

type Phase = "indicator" | "typing";

export function HeroChat() {
  const [done, setDone] = useState<Msg[]>([]);
  const [current, setCurrent] = useState<Msg | null>(null);
  const [typed, setTyped] = useState(0);
  const [phase, setPhase] = useState<Phase>("indicator");
  const [animated, setAnimated] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return; // leave animated=false → render full static script
    setAnimated(true);

    let cancelled = false;
    const schedule = (fn: () => void, ms: number) => {
      const id = window.setTimeout(fn, ms);
      timers.current.push(id);
    };

    function typeChars(msg: Msg, n: number, onComplete: () => void) {
      if (cancelled) return;
      setTyped(n);
      if (n >= msg.text.length) {
        onComplete();
        return;
      }
      const ch = msg.text.charAt(n);
      schedule(() => typeChars(msg, n + 1, onComplete), ch === " " ? SPACE_MS : TYPE_MS);
    }

    function playFrom(i: number) {
      if (cancelled) return;
      if (i >= SCRIPT.length) {
        schedule(() => {
          if (cancelled) return;
          setDone([]);
          setCurrent(null);
          setTyped(0);
          schedule(() => playFrom(0), 420);
        }, LOOP_MS);
        return;
      }
      const msg = SCRIPT[i];
      setCurrent(msg);
      setTyped(0);
      setPhase("indicator");
      schedule(() => {
        if (cancelled) return;
        setPhase("typing");
        typeChars(msg, 0, () => {
          if (cancelled) return;
          setDone((prev) => [...prev, msg]);
          setCurrent(null);
          setTyped(0);
          schedule(() => playFrom(i + 1), GAP_MS);
        });
      }, INDICATOR_MS);
    }

    playFrom(0);
    return () => {
      cancelled = true;
      timers.current.forEach((id) => window.clearTimeout(id));
      timers.current = [];
    };
  }, []);

  const visible = animated ? done : SCRIPT;
  const liveCurrent = animated ? current : null;

  return (
    <div className="float-soft w-full max-w-sm">
      <div className="overflow-hidden rounded-[1.75rem] border border-black/5 bg-white shadow-2xl shadow-green-900/10">
        {/* Phone-style header */}
        <div className="flex items-center gap-3 bg-green-700 px-4 py-3 text-white">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15">
            <Robot size={20} weight="fill" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-tight">CSQ Agent · Toko Kopi Nusantara</p>
            <p className="text-[11px] leading-tight text-green-100">AI menangani percakapan</p>
          </div>
          <DotsThree size={20} weight="bold" className="text-white/80" />
        </div>

        {/* Chat body */}
        <div className="min-h-[340px] space-y-2.5 bg-green-50/50 p-4">
          {visible.map((m, i) => (
            <Bubble key={i} msg={m} />
          ))}
          {liveCurrent && (
            <Bubble
              msg={liveCurrent}
              typing={phase === "typing"}
              typed={typed}
              indicator={phase === "indicator"}
            />
          )}
        </div>

        {/* Fake composer */}
        <div className="flex items-center gap-2 border-t border-slate-100 bg-white px-3 py-2.5">
          <div className="flex-1 rounded-full bg-slate-100 px-3 py-1.5 text-xs text-slate-400">Ketik pesan…</div>
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-green-600 text-white">
            <PaperPlaneRight size={16} weight="fill" />
          </div>
        </div>
      </div>

      {/* Screen-reader + crawler record of the full exchange, independent of
          animation state. */}
      <p className="sr-only">
        Demo percakapan: pelanggan bertanya ketersediaan kopi arabika. Agen AI
        menjawab dari data stok bisnis — masih ada 12 pack, harga Rp85.000.
        Pelanggan meminta diskon menjadi Rp50.000. Agen menolak mengubah harga
        karena di luar kebijakannya, dan meneruskan permintaan diskon ke pemilik
        untuk disetujui. Pelanggan menunggu kabar. Agen akan mengabari setelah
        owner menyetujui.
      </p>
    </div>
  );
}

function Bubble({
  msg,
  typing = false,
  typed = 0,
  indicator = false,
}: {
  msg: Msg;
  typing?: boolean;
  typed?: number;
  indicator?: boolean;
}) {
  if (msg.side === "approval") {
    return (
      <div className="flex justify-end">
        <div className="inline-flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800">
          <ShieldCheck size={14} weight="fill" />
          {msg.text}
        </div>
      </div>
    );
  }
  const isIn = msg.side === "in";
  const text = typing ? msg.text.slice(0, typed) : msg.text;
  return (
    <div className={`flex ${isIn ? "justify-start" : "justify-end"}`}>
      <div
        className={
          isIn
            ? "max-w-[82%] rounded-[1rem_1rem_1rem_0.25rem] bg-slate-100 px-3.5 py-2 text-sm text-slate-800"
            : "max-w-[82%] rounded-[1rem_1rem_0.25rem_1rem] bg-green-100 px-3.5 py-2 text-sm text-green-900"
        }
      >
        {indicator ? (
          <span className="inline-flex items-center gap-1 text-slate-400">
            <Dot /> <Dot delay="0.15s" /> <Dot delay="0.3s" />
          </span>
        ) : (
          <>
            {text}
            {typing && <span className="caret h-[0.9em] align-middle" />}
          </>
        )}
      </div>
    </div>
  );
}

function Dot({ delay = "0s" }: { delay?: string }) {
  return (
    <span
      className="inline-block h-1.5 w-1.5 animate-bounce rounded-full bg-current"
      style={{ animationDelay: delay, animationDuration: "0.9s" }}
    />
  );
}
