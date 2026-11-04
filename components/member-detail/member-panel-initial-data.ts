import type { MemberEnrolment } from "@/lib/services/enrolment";
import type { BatchWithProgramName } from "@/lib/services/programs";
import type { SubscriptionRow } from "@/lib/services/subscriptions";
import type { PlanRow } from "@/lib/services/membership-plans";
import type { MakeupCreditRow, MakeupSessionOption } from "@/lib/services/makeup";

// Owner member detail — the OPTIONAL initial data the owner server page can
// hand to the enrolment and subscription panels.
//
// The panels read their own data on mount for every consumer. On the owner
// overview the page has already resolved the same, already-authorized reads
// on the server, so the panel can start from them instead of queueing a
// client read action. A read action queued at mount is the timing-sensitive
// ingredient the cancel diagnostic pointed at; this is a bounded UI
// composition change, NOT a claim that the framework is at fault.
//
// Both seed shapes NAME their member. A seed is used only for the member it
// names: a payload for another member is ignored (the panel reads for the
// current member), so old rows can never render under a new header and no
// mutation can carry the old member's ids.
//
// `failed` is honest: it seeds the panel's existing error + Retry and makes no
// automatic read, so a refused or failed server read never becomes a healthy
// empty list.

export type MemberEnrolmentSeed =
  | { memberId: string; failed: true }
  | {
      memberId: string;
      enrolments: MemberEnrolment[];
      batches: BatchWithProgramName[];
    };

export type MemberSubscriptionSeed =
  | { memberId: string; failed: true }
  | {
      memberId: string;
      subscriptions: SubscriptionRow[];
      plans: PlanRow[];
    };

export type MemberMakeupSeed =
  | { memberId: string; failed: true }
  | {
      memberId: string;
      credits: MakeupCreditRow[];
      sources: MakeupSessionOption[];
      targets: MakeupSessionOption[];
    };

/** The seed for THIS member, or null when there is none or it is foreign. */
export function seedForMember<T extends { memberId: string }>(
  seed: T | undefined,
  memberId: string,
): T | null {
  return seed && seed.memberId === memberId ? seed : null;
}

/** Whether a usable seed carries a failure rather than rows. */
export function isFailedSeed(
  seed: MemberEnrolmentSeed | MemberSubscriptionSeed | MemberMakeupSeed,
): seed is { memberId: string; failed: true } {
  return "failed" in seed;
}
