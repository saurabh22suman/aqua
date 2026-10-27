import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { AttendanceByBatch } from "@/components/owner-insights-home/attendance-by-batch";
import { EnquiryStages } from "@/components/owner-insights-home/enquiry-stages";
import {
  attendancePreview,
  enquiryPreview,
} from "@/components/owner-insights-home/insight-preview";
import { insightWindowLabel } from "@/components/owner-insights-home/insight-window";
import type {
  AttendanceByBatchInsight,
  EnquiryStageInsight,
} from "@/lib/services/owner-insights";

// The Owner Home insights section.
//
// Two read models that already exist — attendance by batch and
// enquiries by current stage — under the chart band, as ONE compact
// preview with the detail one disclosure away.
//
// The shape is deliberately progressive:
//
//   * the DEFAULT screen is quiet. The section is one sentence per
//     subject and no chart at all, so the Home composition (DESIGN.md
//     §7) is unchanged until the owner asks for more;
//   * the detail is a native <details>, so it works with no JavaScript
//     and with a keyboard;
//   * the bars are CSS, not a chart engine: the section is below the
//     fold on every screen and must not cost a phone a chart library.
//
// Two states are never confused:
//
//   * EMPTY — the read worked and there was nothing in it ("no batch
//     ran a session"). It is a fact about the club.
//   * UNAVAILABLE — the read failed ("could not be read"). It is not a
//     fact about the club and is never drawn as a zero.
//
// The drill-downs keep the scope the figures were computed under. The
// reports drill-down carries the window AND the facility. The enquiries
// list cannot be narrowed to a facility, so under a facility filter it
// is replaced by a sentence that says what it would show — a link that
// widened the view would be worse than no link.

export type OwnerInsightsHomeData = {
  /** Inclusive window start (tenant-local calendar day). */
  from: string;
  /** Exclusive window end (tenant-local calendar day). */
  to: string;
  /** The tenant's timezone, for the printed range. */
  timezone?: string;
  /** null — the read failed. Not an empty result. */
  attendance: AttendanceByBatchInsight | null;
  /** null — the read failed. Not an empty result. */
  enquiries: EnquiryStageInsight | null;
};

// The two subjects, named once: the heading, the unavailable sentence and
// the tests all read the same words.
const ATTENDANCE_SUBJECT = "Attendance by batch";
const ENQUIRY_SUBJECT = "Enquiries by current stage";

export function OwnerInsightsHome({
  data,
  facility = null,
  canOpenEnquiries = false,
}: {
  data: OwnerInsightsHomeData;
  // The facility the figures were scoped to, when one is selected.
  facility?: string | null;
  // Whether the caller may open the enquiries list at all.
  canOpenEnquiries?: boolean;
}) {
  const timezone = data.timezone ?? "Asia/Kolkata";
  const label = insightWindowLabel({ from: data.from, to: data.to }, timezone);

  const reportsHref = (() => {
    const query = new URLSearchParams({ from: data.from, to: data.to });
    if (facility) query.set("facility", facility);
    return `/owner/reports?${query.toString()}`;
  })();

  return (
    <section className="mt-4" aria-label="Insights">
      <SectionHeader className="mb-2" title="Insights" subtitle={`Last 30 days · ${label}`} />

      <article className="rounded-card border border-line bg-paper">
        <div
          data-testid="owner-insights-preview"
          className="grid gap-3 px-4 py-4 sm:grid-cols-2"
        >
          {data.attendance === null ? (
            <Unavailable subject={ATTENDANCE_SUBJECT} />
          ) : (
            <Preview
              title={ATTENDANCE_SUBJECT}
              text={attendancePreview(data.attendance)}
            />
          )}
          {data.enquiries === null ? (
            <Unavailable subject={ENQUIRY_SUBJECT} />
          ) : (
            <Preview
              title={ENQUIRY_SUBJECT}
              text={enquiryPreview(data.enquiries)}
            />
          )}
        </div>

        <details
          data-testid="owner-insights-detail"
          className="group border-t border-line"
        >
          {/* The control says what it will do, says the opposite while
              it is open, and turns a chevron so the state is visible
              without reading the words. The focus ring is applied here
              because the shared rule in app/globals.css does not reach
              a <summary>. */}
          <summary
            className="flex min-h-[44px] cursor-pointer list-none items-center gap-1.5 px-4 text-[13px] font-medium text-ink-2 marker:content-none focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            <span className="group-open:hidden">Show the detail</span>
            <span className="hidden group-open:inline">Hide the detail</span>
            <ChevronDown
              size={14}
              className="text-ink-3 transition-transform group-open:rotate-180 motion-reduce:transition-none"
              aria-hidden="true"
            />
          </summary>
          <div className="space-y-4 px-4 pb-4">
            {data.attendance === null ? (
              <Unavailable subject={ATTENDANCE_SUBJECT} />
            ) : (
              <AttendanceByBatch insight={data.attendance} />
            )}
            {data.enquiries === null ? (
              <Unavailable subject={ENQUIRY_SUBJECT} />
            ) : (
              <EnquiryStages insight={data.enquiries} />
            )}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <Link
                href={reportsHref}
                className="inline-flex min-h-[44px] items-center text-[12.5px] text-[var(--accent-ink)]"
              >
                Open the attendance report →
              </Link>
              {canOpenEnquiries ? (
                facility ? (
                  <p className="text-[12px] text-ink-3">
                    Enquiries for the selected facility only — the enquiries list
                    shows every site.
                  </p>
                ) : (
                  <Link
                    href="/owner/enquiries"
                    className="inline-flex min-h-[44px] items-center text-[12.5px] text-[var(--accent-ink)]"
                  >
                    Open the enquiries list →
                  </Link>
                )
              ) : null}
            </div>
          </div>
        </details>
      </article>
    </section>
  );
}

/** One labelled line of the preview. */
function Preview({ title, text }: { title: string; text: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[12.5px] font-medium text-ink-2">{title}</p>
      <p className="mt-0.5 text-[13px] text-ink">{text}</p>
    </div>
  );
}

/**
 * A read that FAILED. It is not an empty result and it is never drawn as a
 * zero: the block says it could not be read and asks for a reload.
 */
function Unavailable({ subject }: { subject: string }) {
  return (
    <p className="text-[13px] text-ink-2">
      {subject} could not be read — reload to try again.
    </p>
  );
}
