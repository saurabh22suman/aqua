import type {
  AttendanceByBatchInsight,
  EnquiryStageInsight,
} from "@/lib/services/owner-insights";
import { insightWindowPhrase } from "@/components/owner-insights-home/insight-window";

// The two preview sentences.
//
// These are the riskiest words on the screen, so they live in ONE pure
// place: a test can read them without a DOM, and the two subjects
// cannot end up phrased differently from each other.
//
// The rules the sentences obey:
//
//   * register completion is COMPLETION ("3 of 4 sessions fully
//     marked"), never "attendance" — the house rule is that a filled
//     register is not an attended class, and "register" is not a word
//     an owner uses;
//   * the enquiry figure is the CURRENT stage of a cohort — never a
//     conversion rate, because the stages do not add up to a funnel;
//   * no denominator appears that the service did not give us;
//   * nothing was recorded is "no marks recorded", never 0%.
//
// Both functions take the read model as it came from the service. They
// never compute a figure of their own.

/** The one-line summary of the attendance-by-batch read model. */
export function attendancePreview(insight: AttendanceByBatchInsight): string {
  const { rows, summary } = insight;
  if (rows.length === 0) {
    return `No batch ran a session in ${insightWindowPhrase()}.`;
  }

  const parts: string[] = [
    `${rows.length} ${rows.length === 1 ? "batch" : "batches"} ran`,
  ];
  if (summary.marks.total > 0) {
    const presentOrLate = summary.marks.present + summary.marks.late;
    parts.push(
      `${presentOrLate} of ${summary.marks.total} marks present or late`,
    );
  } else {
    parts.push("no marks recorded");
  }
  if (summary.register.sessionsWithRoster > 0) {
    const { completedRegisters, sessionsWithRoster } = summary.register;
    parts.push(
      `${completedRegisters} of ${sessionsWithRoster} ${
        sessionsWithRoster === 1 ? "session" : "sessions"
      } fully marked`,
    );
  }
  return `${parts.join(" · ")}.`;
}

/** The one-line summary of the enquiries-by-current-stage read model. */
export function enquiryPreview(insight: EnquiryStageInsight): string {
  if (insight.total === 0) {
    return `No enquiries created in ${insightWindowPhrase()}.`;
  }
  const stages = insight.rows
    .filter((row) => row.count > 0)
    .map((row) => `${row.count} ${row.label.toLowerCase()}`);
  return `${insight.total} created · ${stages.join(", ")}.`;
}
