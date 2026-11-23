import type { ReactNode } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { SegmentedTabs } from "@/components/ui/SegmentedTabs";

// Owner audit simplification — Announcements is ONE task with two real
// destinations, not two unrelated nav entries:
//
//   Publish   /owner/announcements  compose, targeting and sent history
//   Your inbox /owner/inbox         the caller's own notices
//
// Both pages render this heading so the grouping, the labels and the
// active-view treatment cannot drift. The tabs stay native links (no
// client-side tab state); the active destination carries
// aria-current="page" inside a labelled navigation landmark.
//
// The Publish tab follows the caller's active messaging feature and
// permission. A tenant whose messaging is not active — including an
// inbox-only role such as the Accountant — still opens its own inbox,
// and the legacy Publish URL still explains itself instead of
// pretending a composer is available.
export function OwnerAnnouncementsHeading({
  view,
  canPublish,
  purpose,
}: {
  view: "publish" | "inbox";
  canPublish: boolean;
  purpose: ReactNode;
}) {
  const tabs = canPublish
    ? [
        { key: "publish", label: "Publish", href: "/owner/announcements" },
        { key: "inbox", label: "Your inbox", href: "/owner/inbox" },
      ]
    : [{ key: "inbox", label: "Your inbox", href: "/owner/inbox" }];

  return (
    <div>
      <PageHeader title="Announcements" purpose={purpose} />
      <div className="mt-4">
        <SegmentedTabs
          tabs={tabs}
          active={view}
          ariaLabel="Announcements views"
        />
      </div>
    </div>
  );
}
