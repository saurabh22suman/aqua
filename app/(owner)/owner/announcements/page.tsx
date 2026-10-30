import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { hasFeature, hasPermission } from "@/lib/auth/permission";
import {
  listAnnouncementsAction,
  listMyNotificationsAction,
} from "@/lib/actions/announcements";
import { listBatchesAction } from "@/lib/actions/programs";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { resolveTerm } from "@/lib/terminology/keys";
import { formatDateTimeIST } from "@/lib/time/tz";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { AnnouncementComposer } from "@/components/announcements/announcement-composer";
import { NotificationInbox } from "@/components/announcements/notification-inbox";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader, SectionHeading } from "@/components/ui/PageHeader";

// U-06 — owner announcements surface: compose + sent history +
// the signed-in user's in-app inbox. In-app only; the WhatsApp
// provider remains the C-40a mock.
//
// Owner redesign (C2) — the three surfaces stay distinct: compose and
// the sent history are the academy-wide work (side by side on a
// desktop), and the personal inbox is its own full-width section
// below them. The history states the state of each announcement in a
// word, so "created" and "sent" can be told apart at a glance.

const AUDIENCE_LABELS: Record<string, string> = {
  all: "Everyone",
  batch: "Batch",
  parents: "Parents",
};

export default async function AnnouncementsPage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "messaging.send");
  // F21 — the composer is offered only where its action is entitled: the
  // role grant AND the tenant's messaging feature. The batches read is part
  // of the same decision; an owner who may not send needs no batch list.
  const canSend =
    hasPermission(ctx, "messaging.send") && hasFeature(ctx, "messaging");
  const [announcements, notifications, batches, terminology] = await Promise.all([
    listAnnouncementsAction(),
    listMyNotificationsAction(),
    canSend ? listBatchesAction() : Promise.resolve([]),
    getTerminologyAction(),
  ]);

  return (
    <OwnerPage>
      <PageHeader
        title="Announcements"
        purpose="Send an update to staff and selected contacts. In-app notifications appear immediately; WhatsApp updates queue only for numbers with active communications consent."
      />

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {canSend ? (
          <AnnouncementComposer
            batches={batches}
            memberLabel={resolveTerm(terminology, "member", "other")}
            batchLabel={resolveTerm(terminology, "batch", 1)}
            guardianLabel={resolveTerm(terminology, "guardian", "other")}
          />
        ) : (
          <div
            className="rounded-card border border-line bg-paper p-5"
            data-testid="announcements-unavailable"
          >
            <EmptyState
              title="Sending announcements isn't available"
              body="Messaging isn't enabled for this academy, so announcements can't be sent from here. The sent history and your notifications are still below."
            />
          </div>
        )}

        <section
          aria-label="Sent history"
          className="rounded-card border border-line bg-paper p-5"
        >
          <SectionHeading title="Sent history" />
          {announcements.length === 0 ? (
            <p className="mt-2 text-[13px] text-ink-3">
              No announcements sent yet.
            </p>
          ) : (
            <ul className="mt-1 divide-y divide-line">
              {announcements.map((announcement) => (
                <li key={announcement.id} className="py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[14px] font-medium text-ink">
                      {announcement.title}
                    </span>
                    <span data-testid="announcement-state">
                      <StatusBadge tone={announcement.sentAt ? "good" : "neutral"}>
                        {announcement.sentAt ? "Sent" : "Created"}
                      </StatusBadge>
                    </span>
                  </div>
                  <p className="mt-0.5 text-[12px] text-ink-3">
                    {announcement.sentAt
                      ? formatDateTimeIST(announcement.sentAt)
                      : "No send time recorded"}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-ink-2">
                    {announcement.body}
                  </p>
                  <p className="mt-1 text-[12px] text-ink-3">
                    {AUDIENCE_LABELS[announcement.audience] ?? announcement.audience}
                    {announcement.batchName ? ` · ${announcement.batchName}` : ""} ·{" "}
                    {announcement.recipientCount} in-app notification
                    {announcement.recipientCount === 1 ? "" : "s"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="mt-5">
        <NotificationInbox initial={notifications} />
      </div>
    </OwnerPage>
  );
}
