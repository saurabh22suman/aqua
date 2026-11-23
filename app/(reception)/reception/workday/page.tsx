import type { Metadata } from "next";
import { StaffWorkdayPage } from "@/components/staff-ui/staff-workday-page";
import { requireReception } from "@/lib/auth/surface-guard";

export const metadata: Metadata = { title: { absolute: "My workday · Aqua" } };

export default async function ReceptionWorkdayPage() {
  const ctx = await requireReception();
  return <StaffWorkdayPage ctx={ctx} href="/reception/workday" backHref="/reception" backLabel="Today" />;
}
