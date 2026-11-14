import { getCoachRosterAction } from "@/lib/actions/coach";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { resolveTerm, titleCase } from "@/lib/terminology/keys";
import { CoachRosterSearch } from "@/components/coach-roster-search";
import { requireCoach } from "@/lib/auth/surface-guard";
import {
  STAFF_CARD,
  StaffPage,
  StaffPageHeader,
} from "@/components/staff-ui/staff-page";

export default async function CoachMembersPage() {
  await requireCoach();
  const [roster, terminology] = await Promise.all([
    getCoachRosterAction(),
    getTerminologyAction(),
  ]);

  const memberNoun = resolveTerm(terminology, "member", 1);
  const memberNouns = resolveTerm(terminology, "member", "other");

  return (
    <StaffPage>
      <StaffPageHeader
        title={titleCase(memberNouns)}
        meta={`Find a ${memberNoun} you coach.`}
      />

      {roster.length === 0 ? (
        <div
          className={`mt-5 px-4 py-8 text-center ${STAFF_CARD}`}
          data-testid="coach-roster-empty"
        >
          <p className="text-[15px] font-medium text-ink">
            No {memberNouns} in your batches yet
          </p>
          <p className="mt-2 text-[13px] leading-snug text-ink-3">
            {titleCase(memberNouns)} appear here once they&apos;re enrolled in
            a batch you coach.
          </p>
        </div>
      ) : (
        <CoachRosterSearch roster={roster} memberNouns={memberNouns} />
      )}
    </StaffPage>
  );
}
