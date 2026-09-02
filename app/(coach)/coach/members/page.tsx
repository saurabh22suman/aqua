import { getCoachRosterAction } from "@/lib/actions/coach";

export default async function CoachMembersPage() {
  const roster = await getCoachRosterAction();

  return (
    <main className="px-5 pt-10 pb-8">
      <h1 className="font-display text-[22px] font-semibold text-marine">My members</h1>
      <p className="mt-1 text-[13px] text-ink-3">Members enrolled in your batches</p>

      {roster.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-[15px] font-medium">No members in your batches yet</p>
          <p className="mt-2 text-[13px] text-ink-3">
            Members appear here once they&apos;re enrolled in a batch you coach.
          </p>
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-card border border-line bg-paper">
          {roster.map((m) => (
            <li key={m.memberId} className="px-3.5 py-3">
              <p className="text-[14px] font-medium">{m.name}</p>
              <p className="mt-0.5 text-[12px] text-ink-3">{m.code}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {m.batches.map((b) => (
                  <span key={b} className="rounded-pill bg-deck px-2.5 py-1 text-[11px] font-medium text-ink-2">
                    {b}
                  </span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}