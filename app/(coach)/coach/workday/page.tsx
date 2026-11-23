import type { Metadata } from "next";
import { StaffWorkdayPage } from "@/components/staff-ui/staff-workday-page";
import { requireCoach } from "@/lib/auth/surface-guard";

export const metadata: Metadata = { title: { absolute: "My workday · Aqua" } };

export default async function CoachWorkdayPage() {
  const ctx = await requireCoach();
  return <StaffWorkdayPage ctx={ctx} href="/coach/workday" backHref="/coach/schedule" backLabel="Schedule" />;
}
