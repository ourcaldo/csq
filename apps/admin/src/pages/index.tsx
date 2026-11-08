import type { GetServerSideProps } from "next";
import { getServerSession } from "next-auth";
import { adminAuthOptions } from "@/lib/admin-auth";

// Root redirect: the admin console's entry point is /admin (or /login).
// No root page exists by design - this redirect closes the gap.
export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const session = await getServerSession(ctx.req, ctx.res, adminAuthOptions);
  return {
    redirect: {
      destination: session ? "/admin" : "/login",
      permanent: false,
    },
  };
};

export default function RootRedirect() {
  return null;
}
