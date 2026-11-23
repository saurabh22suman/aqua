import { notFound } from "next/navigation";
import { NotFoundError, requireDefaultCtx } from "@/lib/auth/context";
import { hasFeature, hasPermission } from "@/lib/auth/permission";
import { canAccessSurface, SURFACE_OWNER } from "@/lib/auth/surface-access";
import { requireOwner } from "@/lib/auth/surface-guard";
import { listMyNotifications } from "@/lib/services/announcements";
import { NotificationInbox } from "@/components/announcements/notification-inbox";
import { OwnerAnnouncementsHeading } from "@/components/announcements/owner-announcements-heading";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { BackLink } from "@/components/ui/BackLink";
import { buttonClasses } from "@/components/ui/Button";

export const dynamic = "force-dynamic";

// The owner's personal updates inbox.
//
// The read and the surface boundary are the ones the shared staff inbox
// already enforces: the page authorizes the owner surface, resolves the
// same request context, checks the same surface map and calls the same
// recipient-scoped service. What changes here is only the presentation:
// the inbox now opens inside the owner page frame under the shared
// Announcements heading, with a way back to Home, and a failed read
// becomes a recoverable in-page state instead of taking the whole
// route to the error boundary. An owner who cannot load updates can
// still retry without losing the shell or navigation.
//
// Owner audit simplification (21 November 2026) — Publish and Your
// inbox are two views of one Announcements task. Your inbox is always
// available, including to an inbox-only role and in a tenant whose
// messaging feature is not active; Publish appears only while its
// send permission and messaging feature are both active.
export default async function OwnerInboxPage() {
  await requireOwner();
  const ctx = await requireDefaultCtx();
  if (!canAccessSurface(ctx.roleKey, SURFACE_OWNER)) notFound();
  const canPublish =
    hasPermission(ctx, "messaging.send") && hasFeature(ctx, "messaging");
  const rows = await listMyNotifications(ctx).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    return null;
  });

  return (
    <OwnerPage workflow="directory" className="max-w-3xl">
      <BackLink href="/owner" label="Home" />
      <OwnerAnnouncementsHeading
        view="inbox"
        canPublish={canPublish}
        purpose="Updates sent to you by your club. Open an update and mark it read when you have seen it."
      />
      {rows === null ? (
        <section
          aria-label="Announcements unavailable"
          className="mt-5 rounded-card border border-line bg-paper p-4"
        >
          <p role="alert" className="text-sm text-ink-2">
            Could not load your announcements.
          </p>
          <Link
            href="/owner/inbox"
            className={buttonClasses({ variant: "secondary", size: "sm", className: "mt-3" })}
          >
            Try again
          </Link>
        </section>
      ) : (
        <div className="mt-5">
          <NotificationInbox initial={rows} allowUnreadFilter />
        </div>
      )}
    </OwnerPage>
  );
}
