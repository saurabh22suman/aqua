import { notFound } from "next/navigation";
import { NotFoundError, requireDefaultCtx } from "@/lib/auth/context";
import { canAccessSurface, type TenantSurface } from "@/lib/auth/surface-access";
import { listMyNotifications } from "@/lib/services/announcements";
import { BackLink } from "@/components/ui/BackLink";
import { buttonClasses } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { NotificationInbox } from "@/components/announcements/notification-inbox";

export async function StaffInboxPage({ surface }: { surface: TenantSurface }) {
  const ctx = await requireDefaultCtx();
  if (!canAccessSurface(ctx.roleKey, surface)) notFound();
  // finish/staff — the worker inbox is a staff workday inbox too. It
  // had its own minified branch with no read-error recovery; the three
  // staff surfaces now share one frame and one failure state.
  const workday =
    surface === "coach" || surface === "reception" || surface === "worker";
  if (workday) {
    const home = `/${surface}`;
    const backLabel =
      surface === "coach"
        ? "Coach Today"
        : surface === "reception"
          ? "Reception Today"
          : "Back to My workday";
    const rows = await listMyNotifications(ctx).catch((error: unknown) => {
      if (error instanceof NotFoundError) notFound();
      return null;
    });
    return (
      <main className="mx-auto w-full max-w-xl px-3 pb-5 pt-3 sm:px-5">
        <BackLink href={home} label={backLabel} />
        <PageHeader title="Announcements" className="mb-4" />
        {rows === null ? (
          <section aria-label="Announcements unavailable" className="rounded-card border border-line bg-paper p-4">
            <p role="alert" className="text-sm text-ink-2">Could not load announcements.</p>
            <a href={`${home}/announcements`} className={buttonClasses({ variant: "secondary", size: "sm", className: "mt-3" })}>
              Retry announcements
            </a>
          </section>
        ) : <NotificationInbox initial={rows} workday />}
      </main>
    );
  }
  const rows = await listMyNotifications(ctx);
  return <main className="mx-auto w-full max-w-xl px-4 py-8"><h1 className="mb-4 text-xl font-semibold text-ink">Announcements</h1><NotificationInbox initial={rows} /></main>;
}
