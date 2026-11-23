import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import type { OwnerBriefSession, OwnerBriefView } from "@/lib/services/owner-home-brief";

export function OwnerCollectionsAgenda({
  sessions, historical, agendaState, onRetry, followUps, scheduleHref, canSchedule, canEnquiries,
}: Pick<OwnerBriefView, "followUps" | "scheduleHref"> & {
  sessions: OwnerBriefSession[];
  historical: boolean;
  agendaState: "loading" | "failed" | "ready";
  onRetry: () => void;
  canSchedule: boolean;
  canEnquiries: boolean;
}) {
  if (!canSchedule && !(followUps && canEnquiries)) return null;
  return (
    <section className="owner-collections-agenda" aria-labelledby="brief-today-title">
      <div className="brief-block-title">
        <h2 id="brief-today-title">{canSchedule ? historical ? "Schedule" : "Up next" : "Follow-ups"}</h2>
        {canSchedule ? <Link href={scheduleHref} className="brief-quiet">View schedule</Link> : null}
      </div>
      <div className="brief-block owner-collections-agenda-rows">
        {canSchedule && agendaState === "loading" ? <p className="brief-muted brief-muted-row" role="status">Loading sessions…</p> : null}
        {canSchedule && agendaState === "failed" ? (
          <div className="brief-muted brief-muted-row" role="status">
            Couldn’t load the schedule. <button type="button" onClick={onRetry} className="brief-quiet">Retry</button>
          </div>
        ) : null}
        {canSchedule && agendaState === "ready" ? sessions.length ? sessions.map(session => (
          <Link key={session.id ?? `${session.href}:${session.title}:${session.timeLabel}`} href={session.href} className="brief-row">
            <span className="brief-session-time">{session.timeLabel}</span>
            <span className="brief-row-copy">
              <strong>{session.title}</strong>
              {session.detail ? <span className="brief-secondary">{session.detail}</span> : null}
              {session.statusLabel ? <span className="brief-secondary">{session.statusLabel}</span> : null}
            </span>
            <OwnerIcon name="chevron" size={15} />
          </Link>
        )) : <p className="brief-muted brief-muted-row">No sessions on this date at this facility.</p> : null}
        {followUps && canEnquiries ? (
          <Link href={followUps.href} className="brief-row">
            <span className="brief-row-icon" aria-hidden="true"><OwnerIcon name="enquiry" size={17} /></span>
            <span className="brief-row-copy">
              <strong>{followUps.label}</strong>
              <span className="brief-secondary">{followUps.detail}</span>
            </span>
            <OwnerIcon name="chevron" size={15} />
          </Link>
        ) : null}
      </div>
    </section>
  );
}
