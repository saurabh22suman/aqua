import { StaffInboxPage } from "@/components/announcements/staff-inbox-page";
import { requireOwner } from "@/lib/auth/surface-guard";

export const dynamic = "force-dynamic";

export default async function OwnerInboxPage() {
  await requireOwner();
  return StaffInboxPage({ surface: "owner" });
}
