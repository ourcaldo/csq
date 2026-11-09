// /dashboard/campaigns/[id] - the edit wizard as its own page. Loads the
// campaign client-side through the existing detail API, then hands it to the
// same CampaignWizard the create page uses.
import { useEffect, useState } from "react";
import type { GetServerSideProps } from "next";
import { useRouter } from "next/router";
import { withFeature } from "@csq/core/lib/auth";
import { apiFetch } from "@/lib/api-client";
import type { CampaignRow } from "@csq/core/types/campaign";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { StateNotice } from "@/components/dashboard/state-notice";
import { CampaignWizard } from "@/components/dashboard/campaigns/campaign-wizard";

type EditPageProps = {
  apiMediaBase: string;
};

export default function CampaignEditPage({ apiMediaBase }: EditPageProps) {
  const router = useRouter();
  const id = typeof router.query.id === "string" ? router.query.id : null;

  // Loaded once per id through the plain fetch helper (not useApi) so a
  // failed load renders an error state instead of retry loops.
  const [campaign, setCampaign] = useState<CampaignRow | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void (async () => {
      try {
        const data = await apiFetch<CampaignRow>(
          `/api/dashboard/campaigns/${id}`
        );
        if (!cancelled) setCampaign(data);
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Gagal memuat kampanye.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <DashboardShell
      title="Edit Kampanye"
      description={campaign ? campaign.name : "Ubah pengaturan kampanye."}
    >
      {loadError ? (
        <StateNotice variant="error" message={loadError} />
      ) : (
        <CampaignWizard mode="edit" campaign={campaign} apiMediaBase={apiMediaBase} />
      )}
    </DashboardShell>
  );
}

export const getServerSideProps: GetServerSideProps = withFeature(
  "campaigns",
  async (ctx) => {
    const apiBase = (process.env.API_URL ?? "").replace(/\/$/, "");
    const fallback = (
      process.env.NEXTAUTH_URL ?? `https://${ctx.req.headers.host}`
    ).replace(/\/$/, "");
    return { props: { apiMediaBase: apiBase || fallback } };
  }
);
