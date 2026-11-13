import type { TenantTx } from "@/db/tenant";
import type { SelfScope } from "@/lib/auth/self-scope";
import type { MemberId } from "@/lib/ids";
import { isMinor } from "@/lib/time/tz";
import { signShowcaseLinkToken } from "@/lib/services/showcase/link-token";
import {
  readShowcaseFacts,
  showcaseVisibilityFromFacts,
} from "@/lib/services/showcase/publication";
import {
  allowedShowcaseActions,
  type ShowcaseDecisionKind,
} from "@/lib/services/showcase/visibility";
import {
  listGuardianSubjects,
  resolveShowcaseSubject,
  showcaseTimeZone,
} from "@/lib/services/showcase/subject";

export type ShowcaseSubjectState = {
  memberId: MemberId;
  role: "subject" | "guardian";
  isMinor: boolean | null;
  state: "public" | "private" | "pending";
  reason: string;
  chosenName: string | null;
  allowedActions: ShowcaseDecisionKind[];
  publicPath: string | null;
  lastSubjectAction: ShowcaseDecisionKind | null;
};

export type ShowcaseState = {
  audience: "member" | "guardian";
  subjects: ShowcaseSubjectState[];
};

export async function readShowcaseState(
  tx: TenantTx,
  scope: SelfScope,
): Promise<ShowcaseState> {
  const timeZone = await showcaseTimeZone(tx, scope.tenantId);
  const members: { memberId: MemberId; role: "subject" | "guardian" }[] = [];

  if (scope.audience === "member") {
    if (!scope.memberId) return { audience: "member", subjects: [] };
    const subject = await resolveShowcaseSubject(
      tx,
      scope,
      scope.memberId,
      timeZone,
    );
    if (!subject) return { audience: "member", subjects: [] };
    members.push({ memberId: subject.memberId, role: "subject" });
  } else {
    const children = await listGuardianSubjects(tx, scope, timeZone);
    for (const child of children) {
      members.push({ memberId: child.memberId, role: "guardian" });
    }
  }

  const subjects: ShowcaseSubjectState[] = [];
  for (const entry of members) {
    const facts = await readShowcaseFacts(tx, {
      tenantId: scope.tenantId,
      key: entry.memberId,
      byProfile: false,
    });
    const minorStatus = facts
      ? facts.dateOfBirth === null
        ? null
        : isMinor(facts.dateOfBirth, facts.timezone)
      : null;

    const visibility = facts
      ? showcaseVisibilityFromFacts(facts)
      : {
          publishable: false,
          state: "private" as const,
          reason: "Not published — this member's record is no longer active.",
        };

    const publicPath =
      visibility.publishable && facts?.profileId
        ? `/showcase/${
            signShowcaseLinkToken({
              tenantId: scope.tenantId,
              publicationId: facts.profileId,
            }).token
          }`
        : null;

    subjects.push({
      memberId: entry.memberId,
      role: entry.role,
      isMinor: minorStatus,
      state: visibility.state,
      reason: visibility.reason,
      chosenName: facts?.chosenName ?? null,
      allowedActions: allowedShowcaseActions({
        role: entry.role,
        isMinor: minorStatus,
      }),
      publicPath,
      lastSubjectAction:
        entry.role === "subject" ? (facts?.subjectDecision ?? null) : null,
    });
  }

  return { audience: scope.audience, subjects };
}
