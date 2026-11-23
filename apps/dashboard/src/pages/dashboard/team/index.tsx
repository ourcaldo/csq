// /dashboard/team - legacy Tim page. The team UI moved into the Pengaturan
// workspace (/dashboard/pengaturan/tim, owner request 2026-11-21); this
// route now redirects there. The DATA route /api/dashboard/team stays - the
// inbox assignment picker and staff filter read it.
import type { GetServerSideProps } from "next";
import { withAuth } from "@csq/core/lib/auth";

export const getServerSideProps: GetServerSideProps = withAuth<Record<string, unknown>>(
  async () => ({
    redirect: { destination: "/dashboard/pengaturan/tim", permanent: false },
    props: {},
  }),
  { requiredPermission: "pengaturan.tim" }
);

export default function NeverRendered() {
  return null;
}
