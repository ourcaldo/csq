// /dashboard/pengaturan - the entry point redirects to the first section
// (umum). The settings workspace lives at /dashboard/pengaturan/[section].
import type { GetServerSideProps } from "next";
import { withAuth } from "@csq/core/lib/auth";

export const getServerSideProps: GetServerSideProps = withAuth<Record<string, never>>(
  async () => ({
    redirect: { destination: "/dashboard/pengaturan/umum", permanent: false },
    props: {},
  })
);

export default function NeverRendered() {
  return null;
}
