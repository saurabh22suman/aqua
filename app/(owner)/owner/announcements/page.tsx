import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { hasPermission } from "@/lib/auth/permission";
import {
  listAnnouncementsAction,
  listMyNotificationsAction,
} from "@/lib/actions/announcements";
import { listBatchesAction } from "@/lib/actions/programs";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { resolveTerm } from "@/lib/terminology/keys";
import { formatDateTimeIST } from "@/lib/time/tz";
import { BackLink } from "@/components/ui/BackLink";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { AnnouncementComposer } from "@/components/announcements/announcement-composer";
import { NotificationInbox } from "@/components/announcements/notification-inbox";

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
  const [announcements, notifications, batches, terminology] = await Promise.all([
    listAnnouncementsAction(),
    listMyNotificationsAction(),
    hasPermission(ctx, "messaging.send") ? listBatchesAction() : Promise.resolve([]),
    getTerminologyAction(),
  ]);

  return (
    <main className="px-5 pt-6 pb-8">
      <BackLink href="/owner" label="Home" />
      <h1 className="mt-2 font-display text-[19px] font-semibold">
        Announcements
      </h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        Send in-app notifications and queue WhatsApp updates for relevant staff
        and selected student contacts. The local demo captures messages in the mock viewer.
      </p>

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {hasPermission(ctx, "messaging.send") ? (
          <AnnouncementComposer
            batches={batches}
            memberLabel={resolveTerm(terminology, "member", "other")}
            batchLabel={resolveTerm(terminology, "batch", 1)}
            guardianLabel={resolveTerm(terminology, "guardian", "other")}
          />
        ) : null}

        <section className="rounded-card border border-line bg-paper p-4">
          <h2 className="font-display text-[15px] font-semibold">Sent</h2>
          {announcements.length === 0 ? (
            <p className="mt-2 text-[13px] text-ink-3">
              No announcements sent yet.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {announcements.map((announcement) => (
                <li key={announcement.id} className="py-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[13.5px] font-medium text-ink">
                      {announcement.title}
                    </span>
                    <span data-testid="announcement-state">
                      <StatusBadge tone="neutral">
                        {announcement.sentAt ? "Sent" : "Not sent"}
                      </StatusBadge>
                    </span>
                  </div>
                  <p className="mt-0.5 text-[11.5px] text-ink-3">
                    {announcement.sentAt
                      ? formatDateTimeIST(announcement.sentAt)
                      : "No send time recorded"}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-[12.5px] text-ink-2">
                    {announcement.body}
                  </p>
                  <p className="mt-1 text-[11.5px] text-ink-3">
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

      <div className="mt-4">
        <NotificationInbox initial={notifications} />
      </div>
    </main>
  );
}
