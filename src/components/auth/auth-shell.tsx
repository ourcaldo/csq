// Shared auth layout (login + signup). A split screen: a green brand panel on
// the left that says what CSQ is, and a white form card on the right. On small
// screens the brand panel hides and only the form shows. Grounded in the
// product: AI customer service for Indonesian UMKM, on WhatsApp.
import type { ReactNode } from "react";
import { ChatCircleDots, Sparkle, ShieldCheck, WhatsappLogo } from "@phosphor-icons/react";
import { Seo } from "@/components/seo";

type AuthShellProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
};

export function AuthShell({ title, subtitle, children, footer }: AuthShellProps) {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <Seo title={title} noindex />
      {/* Brand panel */}
      <div className="relative hidden w-1/2 flex-col justify-between overflow-hidden bg-green-700 p-12 text-white lg:flex">
        <div className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15">
            <ChatCircleDots size={22} weight="fill" />
          </div>
          CSQ
        </div>

        <div className="max-w-sm">
          <h2 className="text-3xl font-bold leading-tight">
            Layanan pelanggan AI untuk UMKM Indonesia.
          </h2>
          <p className="mt-3 text-green-100">
            Agent CSAI di WhatsApp yang membaca data usaha Anda dan bertindak
            sesuai izin — baca default, tulis dengan izin.
          </p>
          <ul className="mt-6 space-y-3 text-sm text-green-50">
            <li className="flex items-center gap-2">
              <WhatsappLogo size={18} weight="fill" /> WhatsApp Cloud API + bring-your-own-number
            </li>
            <li className="flex items-center gap-2">
              <Sparkle size={18} weight="fill" /> Agent AI bersama inbox tim
            </li>
            <li className="flex items-center gap-2">
              <ShieldCheck size={18} weight="fill" /> Tulis dengan izin, audit penuh
            </li>
          </ul>
        </div>

        <p className="text-xs text-green-200">© {new Date().getFullYear()} CSQ</p>
      </div>

      {/* Form panel */}
      <div className="flex w-full flex-col items-center justify-center p-6 lg:w-1/2">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 text-xl font-bold tracking-tight text-slate-900 lg:hidden">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-green-600 text-white">
              <ChatCircleDots size={22} weight="fill" />
            </div>
            CSQ
          </div>
          <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
          <div className="mt-6">{children}</div>
          {footer && <div className="mt-6 text-sm text-slate-500">{footer}</div>}
        </div>
      </div>
    </div>
  );
}
