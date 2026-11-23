import { OwnerLink } from "@/components/owner-ui/owner-link";
import { formatWallTime12h, formatWallTime24hIST, formatWeekdayDateIST } from "@/lib/time/tz";
import type { NextClass } from "@/lib/services/dashboard";

export function OwnerHomeNextSession({
  nextClass,
  siteLabel,
  scheduleHref,
}: {
  nextClass: NextClass | null;
  siteLabel: string | null;
  scheduleHref: string | null;
}) {
  const start = nextClass ? new Date(nextClass.startsAt) : null;
  const time = start && Number.isFinite(start.getTime())
    ? formatWallTime24hIST(start)
    : nextClass?.startTime.slice(0, 5);

  return (
    <section className="floodlit-next-session" data-testid="owner-home-next-session" aria-label="Next session">
      {nextClass && time ? (
        <>
          <time aria-label={formatWallTime12h(time)}>{time}</time>
          <div className="min-w-0 flex-1">
            <p className="floodlit-next-label">Next session</p>
            <h3>{nextClass.batchName}</h3>
            <p className="floodlit-next-meta">
              {[formatWeekdayDateIST(nextClass.sessionDate), nextClass.coachName, siteLabel].filter(Boolean).join(" · ")}
            </p>
          </div>
        </>
      ) : <p className="flex-1">No upcoming sessions</p>}
      {scheduleHref ? (
        <OwnerLink href={scheduleHref} className="floodlit-next-link">
          {nextClass ? "Session details" : "View schedule"}
        </OwnerLink>
      ) : null}
    </section>
  );
}
