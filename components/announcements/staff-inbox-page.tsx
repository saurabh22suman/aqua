import { notFound } from "next/navigation";
import { requireDefaultCtx } from "@/lib/auth/context";
import { canAccessSurface, type TenantSurface } from "@/lib/auth/surface-access";
import { listMyNotifications } from "@/lib/services/announcements";
import { NotificationInbox } from "@/components/announcements/notification-inbox";

export async function StaffInboxPage({ surface }: { surface: TenantSurface }) {
  const ctx = await requireDefaultCtx();
  if (!canAccessSurface(ctx.roleKey, surface)) notFound();
  const rows = await listMyNotifications(ctx);
  return <main className="mx-auto w-full max-w-xl px-4 py-8"><h1 className="mb-4 text-xl font-semibold text-ink">Announcements</h1><NotificationInbox initial={rows} /></main>;
}
