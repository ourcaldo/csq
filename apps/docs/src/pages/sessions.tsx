import type { InferGetStaticPropsType } from "next";
import { GuidePage, guideStaticProps } from "@/components/guide-page";

export const getStaticProps = guideStaticProps("sessions");

export default function SessionsPage(
  props: InferGetStaticPropsType<typeof getStaticProps>
) {
  return <GuidePage {...props} />;
}
