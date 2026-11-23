import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import type { OwnerBriefView } from "@/lib/services/owner-home-brief";

// Owner Home — the short "Club today" list.
//
// One next session and, when the same scoped read has them, the overdue
// enquiry follow-ups. Both are links into the existing authorized workflows;
// no follow-up is assigned, messaged or invented here.

export function OwnerBriefToday({
  session,
  followUps,
  scheduleHref,
  canSchedule,
  canEnquiries,
}: Pick<OwnerBriefView, "session" | "followUps" | "scheduleHref"> & {
  canSchedule: boolean;
  canEnquiries: boolean;
}) {
  if (!canSchedule && !(followUps && canEnquiries)) return null;
  return (
    <section className="brief-block" aria-labelledby="brief-today-title">
      <div className="brief-block-title">
        <h2 id="brief-today-title">Club today</h2>
        {canSchedule ? (
          <Link href={scheduleHref} className="brief-quiet">
            Open calendar <OwnerIcon name="chevron" size={14} />
          </Link>
        ) : null}
      </div>
      {session && canSchedule ? (
        <Link href={session.href} className="brief-row">
          <span className="brief-session-time">{session.timeLabel}</span>
          <span className="brief-row-copy">
            <strong>{session.title}</strong>
            <span className="brief-secondary">
              {session.detail}
            </span>
          </span>
          <OwnerIcon name="chevron" size={15} />
        </Link>
      ) : canSchedule ? (
        <p className="brief-muted brief-muted-row">
          No more sessions today at this facility.
        </p>
      ) : null}
      {followUps && canEnquiries ? (
        <Link href={followUps.href} className="brief-row">
          <span className="brief-row-icon" aria-hidden="true">
            <OwnerIcon name="enquiry" size={17} />
          </span>
          <span className="brief-row-copy">
            <strong>{followUps.label}</strong>
            <span className="brief-secondary">{followUps.detail}</span>
          </span>
          <OwnerIcon name="chevron" size={15} />
        </Link>
      ) : null}
    </section>
  );
}
