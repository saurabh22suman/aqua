import type { Metadata } from "next";
import { SelfAccountPage } from "@/components/self-account-page";

export const metadata: Metadata = { title: { absolute: "Family account · Aqua" } };

export default function FamilyAccountPage() {
  return <SelfAccountPage audience="guardian" />;
}
