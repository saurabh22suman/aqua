import { getCoachRosterAction } from "@/lib/actions/coach";
import { CoachRosterSearch } from "@/components/coach-roster-search";

export default async function CoachMembersPage() {
  const roster = await getCoachRosterAction();

  return (
    <main className="px-5 pt-10 pb-8">
      <h1 className="font-display text-[22px] font-semibold text-marine">Members</h1>
      <p className="mt-1 text-[13px] text-ink-3">Find a swimmer you coach.</p>

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
