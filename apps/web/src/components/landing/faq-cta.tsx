// CTA + FAQ combined section (per the faq.txt spec), adapted to CSQ.
// Two-column grid: left = animated-gradient CTA card (CSQ-green blobs, CSS
// @property animation, GPU-friendly, reduced-motion safe), right = FAQ
// accordion with chevron toggle. CSQ content, Phosphor icons (not Lucide).
import { useState } from "react";
import Link from "next/link";
import { CaretDown, CaretUp } from "@phosphor-icons/react";

const FAQS: { q: string; a: string }[] = [
  { q: "Apakah saya butuh coding?", a: "Tidak. CSQ dibuat untuk owner UMKM. Sambungkan data, ajarkan aturan, atur izin dari dashboard, tanpa kode." },
  { q: "Apakah datanya aman?", a: "CSQ self-host: dipasang di server sendiri dengan Docker Compose. Data usaha dan pelanggan tetap di tangan Anda, terpisah per tenant." },
  { q: "Bisa pakai nomor WhatsApp sendiri?", a: "Bisa. Pilih Cloud API resmi Meta atau Baileys menggunakan nomor sendiri lewat QR. Anda memilih saat onboarding, keduanya tersedia." },
  { q: "Kalau AI salah jawab atau melakukan hal di luar batas?", a: "Agent membaca secara default dan menulis hanya dengan izin per tool. Aksi sensitif butuh persetujuan owner. Tiap aksi tercatat untuk audit, dan Anda bisa mengambil alih kapan saja." },
  { q: "Berapa harganya?", a: "CSQ bersifat open untuk dihosting sendiri. Anda hanya perlu membayar server, VPS kecil sudah cukup, plus biaya WhatsApp Cloud API sesuai penggunaan." },
];

export function FaqCta() {
  return (
    <section id="faq" className="bg-white py-20 text-neutral-900 md:py-24">
      <div className="mx-auto max-w-[1100px] w-full px-5">
        <div className="grid grid-cols-1 gap-[30px] items-stretch md:grid-cols-[1.6fr_1fr] md:gap-[60px]">
          {/* Left: animated gradient CTA card */}
          <div
            className="csq-animated-gradient flex flex-col justify-center items-center rounded-[24px] px-10 py-20 text-center text-white"
            style={{ boxShadow: "0 10px 30px rgba(0, 0, 0, 0.05)" }}
          >
            <h2 className="font-normal leading-[1.1] mb-[15px]" style={{ fontSize: "3.5rem", letterSpacing: "-0.03em" }}>
              Siap membuat AI bekerja<br />untuk usaha Anda?
            </h2>
            <p className="text-[0.9rem] mb-[30px] font-normal opacity-85">
              Deploy agent ke WhatsApp dalam hitungan menit.
            </p>
            <Link
              href="/register"
              className="bg-neutral-900 text-white font-semibold cursor-pointer text-[0.95rem] transition-all duration-200 hover:-translate-y-0.5"
              style={{ padding: "14px 32px", borderRadius: "12px", boxShadow: "0 10px 20px rgba(0,0,0,0.3)" }}
            >
              Coba gratis
            </Link>
          </div>

          {/* Right: FAQ accordion */}
          <div className="flex flex-col justify-center gap-3">
            {FAQS.map((f, i) => (
              <FaqItem key={f.q} q={f.q} a={f.a} active={i === 0} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function FaqItem({ q, a, active: initialActive }: { q: string; a: string; active: boolean }) {
  const [active, setActive] = useState(initialActive);
  return (
    <div
      onClick={() => setActive((v) => !v)}
      className="cursor-pointer rounded-[10px] border bg-white px-5 py-[18px] transition-all duration-200"
      style={{
        borderColor: active ? "#eaeaea" : "#f0f0f0",
        boxShadow: active ? "0 4px 12px rgba(0,0,0,0.04)" : "0 2px 8px rgba(0,0,0,0.02)",
      }}
    >
      <div className="flex items-center justify-between text-[0.9rem] font-normal text-neutral-900">
        <span>{q}</span>
        {active ? <CaretUp size={20} /> : <CaretDown size={20} />}
      </div>
      {active && <p className="mt-3 text-[0.9rem] leading-[1.6] text-[#666]">{a}</p>}
    </div>
  );
}
