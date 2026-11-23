import { ownerTerminology } from "@/lib/terminology/owner-terms";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { hasFeature, hasPermission } from "@/lib/auth/permission";
import { listAnnouncementsAction } from "@/lib/actions/announcements";
import { listBatchesAction } from "@/lib/actions/programs";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { resolveTerm } from "@/lib/terminology/keys";
import { formatDateTimeIST } from "@/lib/time/tz";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { AnnouncementComposer } from "@/components/announcements/announcement-composer";
import { OwnerAnnouncementsHeading } from "@/components/announcements/owner-announcements-heading";
import { OwnerSectionLinks } from "@/components/owner-ui/owner-section-links";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { SectionHeading } from "@/components/ui/PageHeader";

// U-06 — owner announcements: Publish is compose, targeting and sent
// history. The caller's private inbox is its own destination
// (/owner/inbox) and is never repeated here. In-app only; the WhatsApp
// provider remains the C-40a mock.
//
// Owner audit simplification (21 November 2026) — Publish and Your
// inbox are two views of one Announcements task. The shared heading
// groups them with native links and marks the active view, and the
// Publish tab follows the active messaging feature/permission. This
// legacy URL stays reachable when messaging is inactive so the owner
// sees the honest unavailable state and the sent history that is left.
//
// The history states the state of each announcement in a word, so
// "created" and "sent" can be told apart at a glance.

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
  const canReadHistory = hasPermission(ctx, "members.read");
  const canSelectBatch = canSend && hasPermission(ctx, "programs.read");
  const [announcements, batches, terminology] = await Promise.all([
    canReadHistory ? listAnnouncementsAction() : Promise.resolve(null),
    canSelectBatch ? listBatchesAction() : Promise.resolve([]),
    getTerminologyAction().then(ownerTerminology),
  ]);

  return (
    <OwnerPage workflow="directory">
      <OwnerAnnouncementsHeading
        view="publish"
        canPublish={canSend}
        purpose={
          canSend
            ? "Send an update to staff and selected contacts."
            : canReadHistory
              ? "Messaging isn't available for this academy. Sent history is kept below."
              : "Messaging isn't available for this academy."
        }
      />

      <OwnerSectionLinks label="Publishing sections" className="mt-3" sections={[
        ...(canSend ? [{ id: "compose-announcement", label: "Compose" }] : []),
        ...(announcements !== null ? [{ id: "sent-announcements", label: "Sent history" }] : []),
      ]} />
      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        {canSend ? (
          <AnnouncementComposer
            batches={batches}
            canSelectBatch={canSelectBatch}
            canReviewHistory={canReadHistory}
            canSendClubWide={hasPermission(ctx, "settings.manage")}
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
              body={
                canReadHistory
                  ? "Messaging isn't enabled for this academy, so announcements can't be sent from here. Sent history is still below."
                  : "Messaging isn't enabled for this academy, so announcements can't be sent from here."
              }
            />
          </div>
        )}

        {announcements !== null ? <section
          id="sent-announcements"
          tabIndex={-1}
          aria-label="Sent history"
          className="min-w-0 rounded-card border border-line bg-paper p-5 scroll-mt-20 [overflow-wrap:anywhere]"
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
                    <span className="min-w-0 text-[14px] font-medium text-ink">
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
        </section> : null}
      </div>
    </OwnerPage>
  );
}
