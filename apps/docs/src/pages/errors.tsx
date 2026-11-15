import type { InferGetStaticPropsType } from "next";
import { GuidePage, guideStaticProps } from "@/components/guide-page";

export const getStaticProps = guideStaticProps("errors");

export default function ErrorsPage(
  props: InferGetStaticPropsType<typeof getStaticProps>
) {
  return <GuidePage {...props} />;
}
