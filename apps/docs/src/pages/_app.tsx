import type { AppProps } from "next/app";
import "@/styles/globals.css";

export default function DocsApp({ Component, pageProps }: AppProps) {
  return <Component {...pageProps} />;
}
