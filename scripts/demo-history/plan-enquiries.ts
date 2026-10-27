import { addDays, zonedWallTimeToInstant } from "@/lib/time/tz";
import { hash01 } from "./keys";
import {
  ENQUIRY_SOURCES,
  ENQUIRY_STAGES,
  ENQUIRY_WALL_TIMES,
  FIRST_NAMES,
  LAST_NAMES,
} from "./catalogue";
import type { PlannedEnquiry, PlannedFollowUp, TenantSnapshot } from "./types";

// The enquiries that came in.
//
// Invented names (disjoint from the demo seed's roster) and invented
// phone numbers, spread across the window with a stage mix that looks
// like a real funnel: mostly new and contacted, a few trials, some
// converted, some lost. More than half carry a follow-up; the ones on
// a settled enquiry are done, the rest are still open — which is what
// the reception desk's "needs attention" lane reads.

export type EnquiryPlan = {
  enquiries: PlannedEnquiry[];
  followUps: PlannedFollowUp[];
};

export function planEnquiries(args: {
  snapshot: TenantSnapshot;
  anchorDate: string;
  windowDays: number;
  nowMs: number;
}): EnquiryPlan {
  const { snapshot, anchorDate, windowDays, nowMs } = args;
  const timezone = snapshot.timezone;
  const enquiries: PlannedEnquiry[] = [];
  const followUps: PlannedFollowUp[] = [];
  const enquiryCount = Math.max(12, Math.round(windowDays / 2));
  const billable = snapshot.members.filter((member) => member.status === "active");

  for (let index = 0; index < enquiryCount; index++) {
    const spread = Math.floor((index * (windowDays - 2)) / enquiryCount);
    const jitter = hash01(`enquiry|${index}|jitter`) > 0.65 ? 1 : 0;
    const daysBack = Math.min(windowDays - 1, 1 + spread + jitter);
    const createdOn = addDays(anchorDate, -daysBack);
    const wallTime =
      ENQUIRY_WALL_TIMES[
        Math.floor(hash01(`enquiry|${index}|time`) * ENQUIRY_WALL_TIMES.length)
      ]!;
    const createdAt = zonedWallTimeToInstant(createdOn, wallTime, timezone);
    if (createdAt.getTime() > nowMs) continue;

    const stage =
      ENQUIRY_STAGES[
        Math.floor(hash01(`enquiry|${index}|stage`) * ENQUIRY_STAGES.length)
      ]!;
    const source =
      ENQUIRY_SOURCES[
        Math.floor(hash01(`enquiry|${index}|source`) * ENQUIRY_SOURCES.length)
      ]!;
    const firstName =
      FIRST_NAMES[
        Math.floor(hash01(`enquiry|${index}|first`) * FIRST_NAMES.length)
      ]!;
    const lastName =
      LAST_NAMES[
        Math.floor(hash01(`enquiry|${index}|last`) * LAST_NAMES.length)
      ]!;
    const key = `enquiry|${index}|${createdOn}`;
    const convertedMember =
      stage === "converted" && billable.length > 0
        ? billable[Math.floor(hash01(`enquiry|${index}|member`) * billable.length)]!
        : null;

    const enquiryFollowUps: PlannedFollowUp[] = [];
    if (hash01(`enquiry|${index}|followup`) < 0.55) {
      const dueOn = addDays(
        createdOn,
        2 + Math.floor(hash01(`enquiry|${index}|due`) * 9),
      );
      const dueAt = zonedWallTimeToInstant(dueOn, "11:00", timezone);
      const settled =
        stage === "converted" ||
        stage === "lost" ||
        stage === "trial_completed";
      const doneAt =
        settled && dueAt.getTime() <= nowMs
          ? new Date(dueAt.getTime() + 30 * 60_000).toISOString()
          : null;
      const followUp: PlannedFollowUp = {
        key: `${key}|followup`,
        enquiryKey: key,
        dueAtIso: dueAt.toISOString(),
        doneAtIso: doneAt,
        note: `Call back about the ${source} enquiry.`,
      };
      enquiryFollowUps.push(followUp);
      followUps.push(followUp);
    }

    enquiries.push({
      key,
      fullName: `${firstName} ${lastName}`,
      phone: `+919812349${String(index + 1).padStart(3, "0")}`,
      source,
      stage,
      createdAtIso: createdAt.toISOString(),
      notes: `Synthetic demo enquiry — asked about batch timings and the fee structure.`,
      memberId: convertedMember ? convertedMember.id : null,
      followUps: enquiryFollowUps,
    });
  }

  return { enquiries, followUps };
}
