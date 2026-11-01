import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { EnquiryStages } from "@/components/owner-insights-home/enquiry-stages";
import { enquiryPreview } from "@/components/owner-insights-home/insight-preview";
import { insightWindowLabel } from "@/components/owner-insights-home/insight-window";
import type { EnquiryStageInsight } from "@/lib/services/owner-insights";

// The Owner Home insights section.
//
// ONE read model that already exists — enquiries by current stage —
// under the trend band, as a compact preview with the detail one
// disclosure away.
//
// ATTENDANCE IS NOT HERE. It used to be: a chart inside the Money
// band, a line in this preview, and an expanded breakdown under it.
// Attendance is an operational fact and it has one home now — the
// attendance panel above — so the same numbers are not shown three
// times on one screen.
//
// The shape is deliberately progressive:
//
//   * the DEFAULT screen is quiet. The section is one sentence and no
//     chart at all, so the Home composition (DESIGN.md §7) is unchanged
//     until the owner asks for more;
//   * the detail is a native <details>, so it works with no JavaScript
//     and with a keyboard;
//   * the bars are CSS, not a chart engine: the section is below the
//     fold on every screen and must not cost a phone a chart library.
//
// Two states are never confused:
//
//   * EMPTY — the read worked and there was nothing in it ("no enquiry
//     was created"). It is a fact about the club.
//   * UNAVAILABLE — the read failed ("could not be read"). It is not a
//     fact about the club and is never drawn as a zero.
//
// This section has its OWN window (the last 30 club days). It is never
// merged with the selected range of the trend band above.

export type OwnerInsightsHomeData = {
  /** Inclusive window start (tenant-local calendar day). */
  from: string;
  /** Exclusive window end (tenant-local calendar day). */
  to: string;
  /** The tenant's timezone. */
  timezone?: string;
  /** null — the read failed. Not an empty result. */
  enquiries: EnquiryStageInsight | null;
};

// The subject, named once: the heading, the unavailable sentence and the
// tests all read the same words.
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
  const label = insightWindowLabel({ from: data.from, to: data.to });

  return (
    <section className="mt-4" aria-label="Insights" data-testid="owner-insights-home">
      <SectionHeader className="mb-2" title="Insights" subtitle={`Last 30 days · ${label}`} />

      <article className="rounded-card border border-line bg-paper">
        {/* ONE preview, ONE column. A two-column grid left half the
            card vacant next to a single preview. */}
        <div
          data-testid="owner-insights-preview"
          className="grid gap-3 px-4 py-4"
        >
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
            {data.enquiries === null ? (
              <Unavailable subject={ENQUIRY_SUBJECT} />
            ) : (
              <EnquiryStages insight={data.enquiries} />
            )}

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
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

/** One labelled line of the preview. The subject is a real heading:
 *  the section has ONE heading for the thing it measures. */
function Preview({ title, text }: { title: string; text: string }) {
  return (
    <div className="min-w-0">
      <h3 className="text-[12.5px] font-medium text-ink-2">{title}</h3>
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
