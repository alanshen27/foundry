import type { Metadata } from "next";
import { DemoIntro } from "@/components/demo/intro";

export const metadata: Metadata = {
  title: "FOUNDRY",
};

/** Title-card page for demo video openers. Public, purely visual. */
export default function DemoIntroPage() {
  return <DemoIntro />;
}
