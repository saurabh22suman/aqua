import { StaffInboxPage } from "@/components/announcements/staff-inbox-page";
import { requireReception } from "@/lib/auth/surface-guard";
export const dynamic = "force-dynamic";
export default async function ReceptionAnnouncementsPage() { await requireReception(); return <StaffInboxPage surface="reception" />; }
