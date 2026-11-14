import { StaffInboxPage } from "@/components/announcements/staff-inbox-page";
import { requireCoach } from "@/lib/auth/surface-guard";
export const dynamic = "force-dynamic";
export default async function CoachAnnouncementsPage() { await requireCoach(); return <StaffInboxPage surface="coach" />; }
