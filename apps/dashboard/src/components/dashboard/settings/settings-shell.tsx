// Dedicated settings workspace layout (PRD 28 follow-up, owner request
// 2026-11-21, reference docs/demo/pengaturan_workspace_csq_enterprise (1).html):
// a SEPARATE page style from the main dashboard - its own left sidebar with
// "Kembali ke Aplikasi", categorized section nav with status indicators,
// and a top bar with breadcrumb + quick-jump search. Each section renders
// at /dashboard/pengaturan/[section] so navigation opens a new page.
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { useSession } from "next-auth/react";
import {
  ArrowLeft,
  Buildings,
  Stack,
  EnvelopeSimple,
  Timer,
  Key,
  ShieldCheck,
  BookOpen,
  MagnifyingGlass,
  X,
  List,
} from "@phosphor-icons/react";
import { cn } from "@csq/ui/lib/utils";
import { Seo } from "@csq/ui/components/seo";

export type SettingsSectionKey =
  | "umum"
  | "sumber-data"
  | "email"
  | "sesi"
  | "api"
  | "audit";

const SECTIONS: {
  key: SettingsSectionKey;
  label: string;
  group: string;
  icon: ReactNode;
}[] = [
  { key: "umum", label: "Umum & Identitas", group: "Organisasi", icon: <Buildings size={16} /> },
  { key: "sumber-data", label: "Hierarki Sumber Data", group: "Organisasi", icon: <Stack size={16} /> },
  { key: "email", label: "Gateway Email", group: "Komunikasi & SLA", icon: <EnvelopeSimple size={16} /> },
  { key: "sesi", label: "Penutupan Sesi", group: "Komunikasi & SLA", icon: <Timer size={16} /> },
  { key: "api", label: "Kunci API", group: "Keamanan & Developer", icon: <Key size={16} /> },
  { key: "audit", label: "Log Audit", group: "Keamanan & Developer", icon: <ShieldCheck size={16} /> },
];

const SECTION_LABELS: Record<SettingsSectionKey, string> = {
  umum: "Umum & Identitas",
  "sumber-data": "Hierarki Sumber Data",
  email: "Gateway Email",
  sesi: "Penutupan Sesi",
  api: "Kunci API",
  audit: "Log Audit",
};

// Quick-jump search mapping (mirrors the reference's keyword table).
function jumpTarget(q: string): SettingsSectionKey | null {
  const s = q.toLowerCase();
  if (s.includes("sumber") || s.includes("excel") || s.includes("sheet")) return "sumber-data";
  if (s.includes("email") || s.includes("smtp") || s.includes("resend")) return "email";
  if (s.includes("sesi") || s.includes("sla") || s.includes("tutup")) return "sesi";
  if (s.includes("api") || s.includes("token") || s.includes("kunci")) return "api";
  if (s.includes("audit") || s.includes("log") || s.includes("ip")) return "audit";
  if (s.includes("umum") || s.includes("usaha") || s.includes("zona")) return "umum";
  return null;
}

export function SettingsShell(props: {
  section: SettingsSectionKey;
  title: string;
  description: string;
  headerExtra?: ReactNode;
  children: ReactNode;
}) {
  const router = useRouter();
  const { data: session } = useSession();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Cmd/Ctrl+K focuses the quick-jump search (reference behavior).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const groups = [...new Set(SECTIONS.map((s) => s.group))];
  const orgName = session?.user?.name ?? "Usaha Anda";
  const orgInitial = orgName.trim().charAt(0).toUpperCase() || "U";
  const email = session?.user?.email ?? "";
  const role = session?.user?.role === "OWNER" ? "Owner" : "Staf";

  function onQuickJump(value: string) {
    const target = jumpTarget(value);
    if (target && target !== props.section) {
      router.push(`/dashboard/pengaturan/${target}`);
    }
  }

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <Seo title={`Pengaturan - ${SECTION_LABELS[props.section]}`} description={props.description} path={router.pathname} noindex />

      {/* Mobile overlay */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/45 backdrop-blur-[2px] md:hidden"
          onClick={() => setDrawerOpen(false)}
          aria-hidden
        />
      )}

      {/* Dedicated settings sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-slate-200 bg-slate-50/80 transition-transform duration-200 md:translate-x-0",
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Exit settings mode */}
        <div className="flex h-14 items-center justify-between border-b border-slate-200/80 px-4">
          <Link
            href="/dashboard"
            className="group inline-flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-200/60 hover:text-slate-900"
          >
            <ArrowLeft size={14} className="text-slate-400 transition-transform group-hover:-translate-x-0.5 group-hover:text-slate-700" />
            <span>Kembali ke Aplikasi</span>
          </Link>
          <button
            onClick={() => setDrawerOpen(false)}
            aria-label="Tutup navigasi"
            className="rounded p-1 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700 md:hidden"
          >
            <X size={16} />
          </button>
        </div>

        {/* Organization context */}
        <div className="border-b border-slate-200/80 px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-900 text-xs font-bold text-white">
              {orgInitial}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-semibold text-slate-900">{orgName}</p>
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" />
                <span className="font-mono text-[10px] text-slate-500">Workspace Aktif</span>
              </div>
            </div>
          </div>
        </div>

        {/* Categorized navigation */}
        <nav aria-label="Navigasi Pengaturan" className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
          {groups.map((group) => (
            <div key={group}>
              <p className="px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {group}
              </p>
              <div className="space-y-0.5">
                {SECTIONS.filter((s) => s.group === group).map((s) => (
                  <Link
                    key={s.key}
                    href={`/dashboard/pengaturan/${s.key}`}
                    onClick={() => setDrawerOpen(false)}
                    className={cn(
                      "flex items-center justify-between rounded-md px-2.5 py-[0.45rem] text-[13px] font-medium transition",
                      props.section === s.key
                        ? "bg-slate-100 font-semibold text-slate-900"
                        : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                    )}
                  >
                    <span className="flex items-center gap-2.5">
                      <span className="text-slate-500">{s.icon}</span>
                      {s.label}
                    </span>
                    {s.key === "email" && <EmailNavDot />}
                    {s.key === "sesi" && <SesiNavState />}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Operator footer */}
        <div className="border-t border-slate-200/80 p-3.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-xs font-semibold text-white">
                {orgInitial}
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-slate-900">{orgName}</p>
                <p className="truncate text-[11px] text-slate-500">{role} - {email}</p>
              </div>
            </div>
          </div>
        </div>
      </aside>

      {/* Main workspace canvas */}
      <div className="flex min-h-screen min-w-0 flex-col md:pl-64">
        {/* Minimalist sticky top bar */}
        <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur-xs md:px-8">
          <div className="flex items-center gap-2.5 text-xs">
            <button
              onClick={() => setDrawerOpen(true)}
              aria-label="Buka navigasi"
              className="rounded p-1.5 text-slate-600 hover:bg-slate-100 md:hidden"
            >
              <List size={18} />
            </button>
            <Link href="/dashboard/pengaturan" className="text-slate-400 hover:text-slate-600">
              Pengaturan
            </Link>
            <span className="text-slate-300">/</span>
            <span className="font-semibold text-slate-900">{SECTION_LABELS[props.section]}</span>
          </div>

          <div className="flex items-center gap-2.5">
            <div className="relative hidden sm:block">
              <MagnifyingGlass size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                ref={searchRef}
                type="text"
                placeholder="Cari pengaturan... (Ctrl+K)"
                onChange={(e) => onQuickJump(e.target.value)}
                className="h-8 w-56 rounded-md border border-slate-200 bg-slate-50 pl-8 pr-3 text-xs text-slate-900 placeholder-slate-400 transition focus:w-72 focus:border-slate-300 focus:bg-white focus:outline-none"
              />
            </div>
            <a
              href="https://csq-docs.onrender.com"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            >
              <BookOpen size={14} />
              <span className="hidden md:inline">Dokumentasi</span>
            </a>
          </div>
        </header>

        {/* Section content: full-width left-aligned rows (reference style) */}
        <main className="flex-1 px-4 py-8 md:px-8">
          <div className="w-full max-w-5xl">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-5">
              <div>
                <h1 className="text-lg font-semibold tracking-tight text-slate-900">{props.title}</h1>
                <p className="mt-1 text-xs text-slate-500">{props.description}</p>
              </div>
              {props.headerExtra}
            </div>
            {props.children}
          </div>
        </main>
      </div>
    </div>
  );
}

// Sidebar status indicators (fetched once, shared across sections).
function EmailNavDot() {
  const [state, setState] = useState<"ok" | "default" | null>(null);
  useEffect(() => {
    let active = true;
    void fetch("/api/dashboard/settings/email", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!active) return;
        const data = d?.data;
        setState(data?.configured ? "ok" : "default");
      })
      .catch(() => {
        if (active) setState("default");
      });
    return () => {
      active = false;
    };
  }, []);
  if (state === null) return null;
  return (
    <span
      className={cn("h-1.5 w-1.5 rounded-full", state === "ok" ? "bg-emerald-500" : "bg-amber-400")}
      title={state === "ok" ? "Terkonfigurasi" : "Menggunakan relay platform"}
    />
  );
}

function SesiNavState() {
  const [state, setState] = useState<boolean | null>(null);
  useEffect(() => {
    let active = true;
    void fetch("/api/dashboard/settings/auto-close", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (active) setState(!!d?.data?.enabled);
      })
      .catch(() => {
        if (active) setState(false);
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <span
      className={cn(
        "font-mono text-[10px]",
        state ? "font-semibold text-emerald-600" : "text-slate-400"
      )}
    >
      {state === null ? "" : state ? "ON" : "OFF"}
    </span>
  );
}
