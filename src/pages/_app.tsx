import type { AppProps } from "next/app";
import type { Session } from "next-auth";
import { SessionProvider } from "next-auth/react";
import "@/styles/globals.css";

export default function App({
  Component,
  pageProps,
}: AppProps<{ session?: Session }>) {
  const { session, ...rest } = pageProps;
  return (
    <SessionProvider session={session}>
      <Component {...rest} />
    </SessionProvider>
  );
}
