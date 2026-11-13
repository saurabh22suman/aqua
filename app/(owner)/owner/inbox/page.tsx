import { StaffInboxPage } from "@/components/announcements/staff-inbox-page";

export const dynamic = "force-dynamic";

export default async function OwnerInboxPage() {
  return StaffInboxPage({ surface: "owner" });
}
