import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { TenantTx } from "@/db/tenant";
import {
  SHOWCASE_CHOSEN_NAME_MAX,
  showcaseDecisions,
  showcaseProfiles,
} from "@/db/schema/showcase";
import { writeAudit } from "@/lib/audit/write";
import { asMemberId, type MemberId } from "@/lib/ids";
import type { SelfScope } from "@/lib/auth/self-scope";
import { resolveShowcaseEligibility } from "@/lib/services/showcase/eligibility";
import {
  allowedShowcaseActions,
  type ShowcaseDecisionKind,
} from "@/lib/services/showcase/visibility";
import {
  resolveShowcaseSubject,
  showcaseTimeZone,
} from "@/lib/services/showcase/subject";

export const showcaseDecisionInput = z
  .object({
    action: z.enum(["approve", "revoke", "no", "permit"]),
    memberId: z.string().uuid().optional(),
    chosenName: z.string().trim().max(SHOWCASE_CHOSEN_NAME_MAX).optional(),
  })
  .strict();

export type ShowcaseDecisionInput = z.infer<typeof showcaseDecisionInput>;

export type ShowcaseRefusalCode =
  | "not_yours"
  | "not_allowed"
  | "needs_name"
  | "name_locked"
  | "busy";

export type ShowcaseDecisionOutcome =
  | { ok: true; memberId: string; action: ShowcaseDecisionKind }
  | { ok: false; code: ShowcaseRefusalCode; message: string };

function refuse(code: ShowcaseRefusalCode, message: string): ShowcaseDecisionOutcome {
  return { ok: false, code, message };
}

function refusalMessage(args: {
  role: "subject" | "guardian";
  isMinor: boolean | null;
}): string {
  if (args.role === "guardian") {
    if (args.isMinor === false) {
      return "This member is an adult now, so only their own decision counts — nobody else can publish or unpublish their achievements.";
    }
    return "There is no date of birth on file for this member, so the club cannot confirm who may decide for them.";
  }
  if (args.isMinor === true) {
    return "A member under 18 does not publish their own page — a linked guardian approves it, and the member chooses whether to object.";
  }
  if (args.isMinor === false) {
    return "Your own decision is required — you can publish your page or take it down.";
  }
  return "There is no date of birth on file, so the club cannot confirm what you may decide. You can still keep your page private.";
}

const DECISION_LOCK_ATTEMPTS = 40;
const DECISION_LOCK_DELAY_MS = 25;

async function lockMemberDecision(
  tx: TenantTx,
  tenantId: string,
  memberId: string,
): Promise<boolean> {
  for (let attempt = 0; attempt < DECISION_LOCK_ATTEMPTS; attempt += 1) {
    const result = await tx.execute(sql`
      select pg_try_advisory_xact_lock(
        hashtextextended(${tenantId} || ':' || ${memberId}, 0)
      ) as locked
    `);
    const rows = (
      result as unknown as { rows: Array<{ locked: boolean | null }> }
    ).rows;
    if (rows[0]?.locked === true) return true;
    await new Promise((resolve) => setTimeout(resolve, DECISION_LOCK_DELAY_MS));
  }
  return false;
}

export async function recordShowcaseDecision(
  tx: TenantTx,
  scope: SelfScope,
  input: ShowcaseDecisionInput,
): Promise<ShowcaseDecisionOutcome> {
  const requestId = randomUUID();

  let memberId: MemberId;
  if (scope.audience === "member") {
    if (!scope.memberId) {
      return refuse("not_yours", "There is no member on this session.");
    }
    if (input.memberId && input.memberId !== scope.memberId) {
      return refuse("not_yours", "This decision is about your own page.");
    }
    memberId = scope.memberId;
  } else {
    if (!input.memberId) {
      return refuse("not_yours", "Choose which member this decision is about.");
    }
    memberId = asMemberId(input.memberId);
  }

  const timeZone = await showcaseTimeZone(tx, scope.tenantId);
  const subject = await resolveShowcaseSubject(tx, scope, memberId, timeZone);
  if (!subject) {
    return refuse(
      "not_yours",
      "That member is not yours to decide for, or the link is no longer live.",
    );
  }

  const locked = await lockMemberDecision(tx, scope.tenantId, memberId);
  if (!locked) {
    return refuse(
      "busy",
      "Another decision for this member is being recorded. Please try again.",
    );
  }

  const allowed = allowedShowcaseActions({
    role: subject.deciderRole,
    isMinor: subject.isMinor,
  });
  if (!allowed.includes(input.action)) {
    return refuse(
      "not_allowed",
      refusalMessage({ role: subject.deciderRole, isMinor: subject.isMinor }),
    );
  }

  if (input.action === "approve") {
    const eligibility = resolveShowcaseEligibility({
      isMinor: subject.isMinor === true,
      subjectPersonId: subject.subjectPersonId,
      consentState: "approved",
      decider: {
        personId: subject.deciderPersonId,
        isRegisteredGuardian: subject.deciderRole === "guardian",
      },
    });
    if (!eligibility.eligible) {
      return refuse("not_allowed", eligibility.reason);
    }
  }

  const existing = await tx
    .select({
      id: showcaseProfiles.id,
      chosenName: showcaseProfiles.chosenName,
    })
    .from(showcaseProfiles)
    .where(
      and(
        eq(showcaseProfiles.tenantId, scope.tenantId),
        eq(showcaseProfiles.memberId, memberId),
      ),
    )
    .limit(1);
  const profile = existing[0] ?? null;

  if (input.action === "approve") {
    if (!profile) {
      const chosenName = input.chosenName?.trim();
      if (!chosenName) {
        return refuse(
          "needs_name",
          "Choose the name your page will show before you publish it.",
        );
      }
      const created = await tx
        .insert(showcaseProfiles)
        .values({
          tenantId: scope.tenantId,
          memberId,
          subjectPersonId: subject.subjectPersonId,
          chosenName,
        })
        .returning({ id: showcaseProfiles.id });
      const profileId = created[0]?.id ?? memberId;
      await writeAudit(tx, {
        tenantId: scope.tenantId,
        actorType: "user",
        actorId: scope.userId,
        action: "showcase.profile.create",
        entityType: "showcase_profile",
        entityId: profileId,
        after: { memberId, chosenName },
        changedFields: ["chosenName"],
        requestId,
      });
    } else if (
      input.chosenName &&
      input.chosenName.trim() !== profile.chosenName
    ) {
      return refuse(
        "name_locked",
        "The chosen name cannot be changed in this release — it is set once, when the page is first set up.",
      );
    }
  }

  const inserted = await tx
    .insert(showcaseDecisions)
    .values({
      tenantId: scope.tenantId,
      memberId,
      subjectPersonId: subject.subjectPersonId,
      deciderPersonId: subject.deciderPersonId,
      deciderUserId: subject.deciderUserId,
      ...(subject.deciderRole === "guardian"
        ? { guardianLinkId: subject.sourceLinkId }
        : { memberLinkId: subject.sourceLinkId }),
      deciderRole: subject.deciderRole,
      decision: input.action,
    })
    .returning({ id: showcaseDecisions.id });
  const decisionId = inserted[0]?.id;
  if (!decisionId) {
    throw new Error("showcase: the decision row was not written");
  }

  await writeAudit(tx, {
    tenantId: scope.tenantId,
    actorType: "user",
    actorId: scope.userId,
    action: "showcase.decision",
    entityType: "showcase_decision",
    entityId: decisionId,
    after: {
      decision: input.action,
      deciderRole: subject.deciderRole,
      memberId,
      deciderUserId: subject.deciderUserId,
      sourceLinkId: subject.sourceLinkId,
    },
    changedFields: ["decision"],
    requestId,
  });

  return { ok: true, memberId, action: input.action };
}
