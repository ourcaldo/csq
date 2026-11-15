import type { InferGetStaticPropsType } from "next";
import { GuidePage, guideStaticProps } from "@/components/guide-page";

export const getStaticProps = guideStaticProps("introduction");

export default function IntroductionPage(
  props: InferGetStaticPropsType<typeof getStaticProps>
) {
  return <GuidePage {...props} />;
}
