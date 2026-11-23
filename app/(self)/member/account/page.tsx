import type { Metadata } from "next";
import { SelfAccountPage } from "@/components/self-account-page";

export const metadata: Metadata = { title: { absolute: "Member account · Aqua" } };

export default function MemberAccountPage() {
  return <SelfAccountPage audience="member" />;
}
