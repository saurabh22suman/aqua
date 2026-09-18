import type { UtilisationReport } from "@/lib/services/utilisation";

// V-08 — facility utilisation card on /owner/reports. Reads the last
// 4 weeks: per-facility booked ÷ available minutes (business hours),
// and the emptiest recurring day+hour bucket. When a location has no
// business hours configured the card says so rather than inventing
// availability.

const DAY_LABELS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function formatHour(hour: number): string {
  const suffix = hour < 12 ? "am" : "pm";
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}${suffix}`;
}

export function UtilisationCard({ report }: { report: UtilisationReport }) {
  const emptiest = report.emptiest;
  return (
    <article
      className="bg-paper border border-line rounded-card p-4"
      data-testid="utilisation-card"
    >
      <header className="flex items-baseline justify-between gap-2">
        <h2 className="font-display text-[15px] font-semibold">
          Facility utilisation
        </h2>
        <span className="text-[12px] text-ink-3">last 4 weeks</span>
      </header>

      {report.facilities.length === 0 ? (
        <p className="mt-2 text-[13px] text-ink-3">
          No facilities to report yet. Add a pool, court or turf in Settings.
        </p>
      ) : (
        <ul className="mt-3 space-y-3" data-testid="utilisation-facilities">
          {report.facilities.map((facility) => (
            <li key={facility.facilityId}>
              <div className="flex items-baseline justify-between gap-3 text-[13px]">
                <span className="min-w-0 truncate">{facility.facilityName}</span>
                <span className="flex-none text-ink-3 tabular-nums">
                  {facility.utilisationPct === null
                    ? "hours unset"
                    : `${facility.utilisationPct}%`}
                </span>
              </div>
              <div className="mt-1.5 h-1.5 rounded-pill bg-deck overflow-hidden">
                <div
                  className="h-full rounded-pill bg-water"
                  style={{ width: `${facility.utilisationPct ?? 0}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {!report.businessHoursConfigured ? (
        <p className="mt-3 text-[13px] text-ink-3">
          Set opening hours in Settings → Locations to make utilisation
          meaningful.
        </p>
      ) : emptiest ? (
        <p className="mt-3 text-[13px] text-ink-2" data-testid="emptiest-slot">
          Emptiest slot:{" "}
          <span className="font-medium text-ink">
            {DAY_LABELS[emptiest.dayOfWeek]} {formatHour(emptiest.hour)}
          </span>{" "}
          · {emptiest.utilisationPct}% booked
        </p>
      ) : null}
    </article>
  );
}
