// /dashboard/plan - legacy Paket & Kuota page. The billing UI moved into
// the Pengaturan workspace (/dashboard/pengaturan/paket, owner request
// 2026-11-21); this route now redirects there. Kept as a redirect so old
// bookmarks land correctly.
import type { GetServerSideProps } from "next";
import { withAuth } from "@csq/core/lib/auth";

export const getServerSideProps: GetServerSideProps = withAuth<Record<string, unknown>>(
  async () => ({
    redirect: { destination: "/dashboard/pengaturan/paket", permanent: false },
    props: {},
  }),
  { requiredRole: "OWNER" }
);

export default function NeverRendered() {
  return null;
}
