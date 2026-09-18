import { requireOwner } from "@/lib/auth/surface-guard";
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
import { AnnouncementComposer } from "@/components/announcements/announcement-composer";
import { NotificationInbox } from "@/components/announcements/notification-inbox";

// U-06 — owner announcements surface: compose + sent history +
// the signed-in user's in-app inbox. In-app only; the WhatsApp
// provider remains the C-40a mock.

const AUDIENCE_LABELS: Record<string, string> = {
  all: "Everyone",
  batch: "Batch",
  parents: "Parents",
};

export default async function AnnouncementsPage() {
  const ctx = await requireOwner();
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
        One message to staff, a batch&apos;s families or every guardian —
        delivered as in-app notifications. WhatsApp remains a non-production
        mock, so no WhatsApp message is attempted.
      </p>

      <div className="mt-4 space-y-4">
        {hasPermission(ctx, "messaging.send") ? (
          <AnnouncementComposer
            batches={batches}
            memberLabel={resolveTerm(terminology, "member", "other")}
            batchLabel={resolveTerm(terminology, "batch", 1)}
            guardianLabel={resolveTerm(terminology, "guardian", "other")}
          />
        ) : null}

        <NotificationInbox initial={notifications} />

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
                    <span className="text-[11.5px] text-ink-3">
                      {announcement.sentAt
                        ? formatDateTimeIST(announcement.sentAt)
                        : "Not sent"}
                    </span>
                  </div>
                  <p className="mt-0.5 whitespace-pre-wrap text-[12.5px] text-ink-2">
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
    </main>
  );
}
