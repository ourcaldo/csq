import type { InferGetStaticPropsType } from "next";
import { GuidePage, guideStaticProps } from "@/components/guide-page";

export const getStaticProps = guideStaticProps("quickstart");

export default function QuickstartPage(
  props: InferGetStaticPropsType<typeof getStaticProps>
) {
  return <GuidePage {...props} />;
}
