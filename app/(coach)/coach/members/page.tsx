import { getCoachRosterAction } from "@/lib/actions/coach";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { resolveTerm } from "@/lib/terminology/keys";
import { CoachRosterSearch } from "@/components/coach-roster-search";
import { requireCoach } from "@/lib/auth/surface-guard";

export default async function CoachMembersPage() {
  await requireCoach();
  const [roster, terminology] = await Promise.all([
    getCoachRosterAction(),
    getTerminologyAction(),
  ]);

  return (
    <main className="px-5 pt-10 pb-8">
      <h1 className="font-display text-[22px] font-semibold text-marine">Members</h1>
      <p className="mt-1 text-[13px] text-ink-3">
        Find a {resolveTerm(terminology, "member", 1)} you coach.
      </p>

      {roster.length === 0 ? (
        <div className="text-center py-12" data-testid="coach-roster-empty">
          <p className="text-[15px] font-medium">No members in your batches yet</p>
          <p className="mt-2 text-[13px] text-ink-3">
            Members appear here once they&apos;re enrolled in a batch you coach.
          </p>
        </div>
      ) : (
        <CoachRosterSearch roster={roster} />
      )}
    </main>
  );
}
