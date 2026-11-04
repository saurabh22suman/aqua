// The enquiry list — the owner's oversight table, the phone's divided
// list and reception's own list.
//
// PRESENTATION ONLY. The board owns the enquiries, the capture and the
// stage transitions; this file draws the rows and nothing else. Both
// consumers of the board (the owner's oversight and reception's front
// desk) read the same rows, so the phone and the desktop say the same
// thing about the same enquiry.

import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { ENQUIRY_STAGE_LABELS } from "@/lib/enquiry-stage-graph";
import {
  StatusBadge,
  ENQUIRY_STAGE_TONE,
} from "@/components/ui/StatusBadge";
import { EmptyState } from "@/components/ui/EmptyState";
import { formatPhoneIN } from "@/lib/phone";
import { formatDateIST } from "@/lib/time/tz";
import type { EnquiryRow } from "@/lib/services/enquiries";

/**
 * Which surface this list serves.
 *
 * `front-desk` — reception's own list, under its always-visible
 * capture. `oversight` — the owner's board: the current enquiries
 * lead, with their drill-down.
 */
export type EnquiriesListVariant = "front-desk" | "oversight";

/**
 * The day the enquiry arrived, in the product's own zone (IST).
 *
 * The row data already carried `createdAt`; this is the one place that
 * draws it, so a phone and a desktop say the same day. It is a DAY, not
 * a moment: the row stays scannable, and the exact instant belongs to
 * the enquiry itself.
 */
function EnquiryCreatedAt({ createdAt }: { createdAt: Date }) {
  return (
    <span data-testid="enquiry-row-created" className="whitespace-nowrap">
      {formatDateIST(createdAt)}
    </span>
  );
}

export function EnquiryList({
  enquiries,
  detailHrefPrefix,
  variant = "front-desk",
}: {
  enquiries: EnquiryRow[];
  detailHrefPrefix: string;
  variant?: EnquiriesListVariant;
}) {
  if (enquiries.length === 0) {
    return (
      <div className="rounded-ctl border border-line">
        <EmptyState
          title="No enquiries yet"
          body="Capture a walk-in, phone call or online lead — name and source only at first contact."
        />
      </div>
    );
  }

  if (variant === "oversight") {
    return (
      <section
        aria-labelledby="current-enquiries-heading"
        className="rounded-card border border-line bg-paper p-5"
      >
        <h2
          id="current-enquiries-heading"
          className="font-display text-[16px] font-semibold text-ink"
        >
          Current enquiries
        </h2>
        <div data-testid="enquiries-list" className="mt-1">
        <table
          aria-label="Current enquiries"
          className="hidden w-full border-collapse text-[13px] md:table"
        >
          <thead>
            <tr className="border-b border-line text-left text-[11px] uppercase tracking-[0.08em] text-ink-3">
              <th scope="col" className="py-2.5 pr-3 font-medium">
                Person
              </th>
              <th scope="col" className="py-2.5 pr-3 font-medium">
                Source
              </th>
              <th scope="col" className="py-2.5 pr-3 font-medium">
                Current stage
              </th>
              <th scope="col" className="py-2.5 text-right font-medium">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {enquiries.map((enquiry) => (
              <tr key={enquiry.id} className="border-b border-line last:border-0">
                <td className="py-3 pr-3">
                  <Link
                    href={`${detailHrefPrefix}/${enquiry.id}`}
                    className="flex min-h-11 flex-col justify-center"
                  >
                    <span className="text-[14px] font-medium leading-tight text-ink">
                      {enquiry.fullName}
                    </span>
                    <span className="mt-0.5 text-[12px] text-ink-3">
                      {enquiry.phone ? formatPhoneIN(enquiry.phone) : "No phone"}
                      {enquiry.locationId ? "" : " · Unassigned site"}
                      {" · "}
                      <EnquiryCreatedAt createdAt={enquiry.createdAt} />
                    </span>
                  </Link>
                </td>
                <td className="py-3 pr-3 text-ink-2">{enquiry.source}</td>
                <td className="py-3 pr-3">
                  <StatusBadge
                    tone={ENQUIRY_STAGE_TONE[enquiry.stage] ?? "neutral"}
                  >
                    {ENQUIRY_STAGE_LABELS[enquiry.stage]}
                  </StatusBadge>
                </td>
                <td className="py-3 text-right">
                  <Link
                    href={`${detailHrefPrefix}/${enquiry.id}`}
                    aria-label={`Open ${enquiry.fullName}`}
                    className="inline-flex min-h-11 items-center text-[13px] font-medium text-[var(--accent-ink)] underline underline-offset-2 hover:text-ink"
                  >
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <ul className="divide-y divide-line md:hidden">
          {enquiries.map((enquiry) => (
            <li key={enquiry.id}>
              <Link
                href={`${detailHrefPrefix}/${enquiry.id}`}
                className="flex items-start gap-3 py-3"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium text-ink">
                    {enquiry.fullName}
                  </span>
                  <span className="mt-0.5 block text-[12px] text-ink-3">
                    {enquiry.source}
                    {enquiry.phone ? ` · ${formatPhoneIN(enquiry.phone)}` : ""}
                    {enquiry.locationId ? "" : " · Unassigned site"}
                    {" · "}
                    <EnquiryCreatedAt createdAt={enquiry.createdAt} />
                  </span>
                </span>
                <StatusBadge
                  tone={ENQUIRY_STAGE_TONE[enquiry.stage] ?? "neutral"}
                >
                  {ENQUIRY_STAGE_LABELS[enquiry.stage]}
                </StatusBadge>
              </Link>
            </li>
          ))}
        </ul>
        </div>
      </section>
    );
  }

  return (
    <ul data-testid="enquiries-list">
      {enquiries.map((e) => (
        <li key={e.id} className="border-b border-line last:border-0">
          <Link href={`${detailHrefPrefix}/${e.id}`} className="flex items-center gap-3 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-medium">{e.fullName}</p>
              <p className="mt-0.5 text-[12px] text-ink-3">
                {e.source}
                {e.phone ? ` · ${formatPhoneIN(e.phone)}` : ""}
                {/* R04 — only management sees an unassigned row; the
                    label makes the review state explicit. */}
                {e.locationId ? "" : " · Unassigned site"}
              </p>
            </div>
            <StatusBadge tone={ENQUIRY_STAGE_TONE[e.stage] ?? "neutral"}>
              {ENQUIRY_STAGE_LABELS[e.stage]}
            </StatusBadge>
          </Link>
        </li>
      ))}
    </ul>
  );
}
