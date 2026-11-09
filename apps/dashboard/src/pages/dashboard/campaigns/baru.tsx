// /dashboard/campaigns/baru - the create wizard as its own page (owner
// request 2026-11-10: no more popup). All wizard state lives in
// CampaignWizard; this page is the shell around it.
import type { GetServerSideProps } from "next";
import { withFeature } from "@csq/core/lib/auth";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { CampaignWizard } from "@/components/dashboard/campaigns/campaign-wizard";

type BaruPageProps = {
  apiMediaBase: string;
};

export default function CampaignsBaruPage({ apiMediaBase }: BaruPageProps) {
  return (
    <DashboardShell
      title="Kampanye Baru"
      description="Empat langkah: saluran, penerima, pesan, lalu jadwal."
    >
      <CampaignWizard mode="create" campaign={null} apiMediaBase={apiMediaBase} />
    </DashboardShell>
  );
}

export const getServerSideProps: GetServerSideProps = withFeature(
  "campaigns",
  async (ctx) => {
    // Media thumbnails point at the api service's origin (media serving lives
    // there since Phase 7).
    const apiBase = (process.env.API_URL ?? "").replace(/\/$/, "");
    const fallback = (
      process.env.NEXTAUTH_URL ?? `https://${ctx.req.headers.host}`
    ).replace(/\/$/, "");
    return { props: { apiMediaBase: apiBase || fallback } };
  }
);
