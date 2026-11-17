import { readShowcasePublicationSnapshot } from "./publication-query";
import { withTenant, type TenantTx } from "@/db/tenant";
import { asTenantId, type TenantId } from "@/lib/ids";
import { brandDataFrom } from "@/lib/services/branding";
import { isMinor } from "@/lib/time/tz";
import {
  toPublicShowcaseView,
  type PublicShowcaseView,
} from "@/lib/services/showcase/public-view";
import { verifyShowcaseLinkToken } from "@/lib/services/showcase/link-token";
import {
  resolveShowcaseVisibility,
  type ShowcaseDeciderStanding,
  type ShowcaseDecisionKind,
  type ShowcaseVisibility,
} from "@/lib/services/showcase/visibility";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ShowcaseFacts = {
  profileId: string | null;
  memberId: string;
  subjectPersonId: string;
  chosenName: string | null;
  dateOfBirth: string | null;
  timezone: string;
  clubName: string;
  subjectDecision: ShowcaseDecisionKind | null;
  subjectIdentityCurrent: boolean;
  guardianStandings: ShowcaseDeciderStanding[];
  achievements: { label: string; level: string }[];
};

export async function readShowcaseFacts(
  tx: TenantTx,
  args: { tenantId: TenantId; key: string; byProfile: boolean },
): Promise<ShowcaseFacts | null> {
  const result = await readShowcasePublicationSnapshot(tx, args);

  const rows = (
    result as unknown as {
      rows: Array<{
        member_id: string;
        subject_person_id: string;
        date_of_birth: string | null;
        timezone: string | null;
        tenant_name: string | null;
        branding: unknown;
        profile_id: string | null;
        chosen_name: string | null;
        subject_decision: ShowcaseDecisionKind | null;
        subject_identity_current: boolean | null;
        guardian_standings: unknown;
        achievements: unknown;
      }>;
    }
  ).rows;
  const row = rows[0];
  if (!row) return null;

  const branding = brandDataFrom(row.tenant_name ?? "", row.branding);
  const achievements = Array.isArray(row.achievements)
    ? (row.achievements as Array<{ label?: unknown; level?: unknown }>)
        .map((item) => ({
          label: typeof item.label === "string" ? item.label : "",
          level: typeof item.level === "string" ? item.level : "",
        }))
    : [];

  const guardianStandings: ShowcaseDeciderStanding[] = Array.isArray(
    row.guardian_standings,
  )
    ? (
        row.guardian_standings as Array<{
          deciderPersonId?: unknown;
          decision?: unknown;
          identityCurrent?: unknown;
        }>
      )
        .filter(
          (entry) =>
            typeof entry.deciderPersonId === "string" &&
            (entry.decision === "approve" ||
              entry.decision === "revoke" ||
              entry.decision === "no" ||
              entry.decision === "permit"),
        )
        .map((entry) => ({
          deciderPersonId: entry.deciderPersonId as string,
          decision: entry.decision as ShowcaseDecisionKind,
          identityCurrent: entry.identityCurrent === true,
        }))
    : [];

  return {
    profileId: row.profile_id ?? null,
    memberId: row.member_id,
    subjectPersonId: row.subject_person_id,
    chosenName: row.chosen_name ?? null,
    dateOfBirth: row.date_of_birth ?? null,
    timezone: row.timezone || "Asia/Kolkata",
    clubName: branding.displayName ?? branding.fallbackDisplayName,
    subjectDecision: row.subject_decision ?? null,
    subjectIdentityCurrent: row.subject_identity_current === true,
    guardianStandings,
    achievements,
  };
}

export function showcaseVisibilityFromFacts(
  facts: ShowcaseFacts,
): ShowcaseVisibility {
  return resolveShowcaseVisibility({
    isMinor:
      facts.dateOfBirth === null
        ? null
        : isMinor(facts.dateOfBirth, facts.timezone),
    subjectDecision: facts.subjectDecision,
    subjectIdentityCurrent: facts.subjectIdentityCurrent,
    guardianStandings: facts.guardianStandings,
    hasChosenName: (facts.chosenName ?? "").trim().length > 0,
  });
}

export async function resolvePublicShowcase(
  token: string,
): Promise<PublicShowcaseView | null> {
  const claims = verifyShowcaseLinkToken(token);
  if (!claims) return null;
  if (!UUID_RE.test(claims.tenantId)) return null;
  if (!UUID_RE.test(claims.publicationId)) return null;

  const tenantId = asTenantId(claims.tenantId);
  const facts = await withTenant(tenantId, (tx) =>
    readShowcaseFacts(tx, {
      tenantId,
      key: claims.publicationId,
      byProfile: true,
    }),
  );
  if (!facts || !facts.profileId) return null;

  const visibility = showcaseVisibilityFromFacts(facts);
  if (!visibility.publishable) return null;

  return toPublicShowcaseView({
    chosenName: facts.chosenName ?? "",
    clubName: facts.clubName,
    achievements: facts.achievements,
  });
}
