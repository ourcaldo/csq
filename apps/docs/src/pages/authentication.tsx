import type { InferGetStaticPropsType } from "next";
import { GuidePage, guideStaticProps } from "@/components/guide-page";

export const getStaticProps = guideStaticProps("authentication");

export default function AuthenticationPage(
  props: InferGetStaticPropsType<typeof getStaticProps>
) {
  return <GuidePage {...props} />;
}
