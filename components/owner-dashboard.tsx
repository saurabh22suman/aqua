import { AlertTriangle, ChevronRight, Clock } from "lucide-react";
import type { OwnerDashboardData } from "@/lib/services/dashboard";

// S4 (Owner home) — composition follows docs/sports-club-ui-direction.html's
// "Owner · home" mockup: one dominant hero, three stat chips, a
// reason-stated needs-attention list, then the lane strip (the same
// signature element components/register-board.tsx uses, reused here
// for batch capacity per DESIGN.md's "three reuses" note). The
// mockup's hero and one chip are money-shaped ("To collect ₹18,200",
// "₹82,450 Collected in Aug") — no money table exists in this
// codebase yet (C-28 through C-39 unbuilt), so those are replaced
// with today's real attendance-marking progress and a real member
// count. Never a rupee sign, never an invented number.
export function OwnerDashboard({ data }: { data: OwnerDashboardData }) {
  const dayLabel = new Date(`${data.today}T00:00:00`).toLocaleDateString("en-IN", {
    weekday: "long",
  });
  const todayPct = data.todayTotal > 0 ? Math.round((data.todayMarked / data.todayTotal) * 100) : null;

  return (
    <main className="px-5 pt-6 pb-8">
      <div className="flex items-center gap-3 pb-4">
        <div className="h-11 w-11 rounded-ctl bg-water-soft text-water grid place-items-center font-display font-semibold text-[15px] flex-none">
          {data.tenantName.slice(0, 2).toUpperCase()}
        </div>
        <div>
          <h1 className="font-display text-[19px] font-semibold leading-tight">{data.tenantName}</h1>
          <p className="text-[12.5px] text-ink-3">{dayLabel}</p>
        </div>
      </div>

      {/* Hero: today's attendance-marking progress across every batch —
          the honest substitute for the mockup's money figure. Null
          (not 0%) when nothing is scheduled today at all; that's a
          different, truthful state, not a fabricated zero. */}
      <div className="rounded-card bg-marine px-5 py-5 text-white">
        <p className="text-[12.5px] font-medium text-[#9CC4BE]">Today&apos;s registers</p>
        {data.todayTotal > 0 ? (
          <>
            <p className="mt-1.5 mb-1 font-display text-[38px] font-semibold tracking-tight leading-none">
              {todayPct}%
            </p>
            <p className="text-[13px] text-[#B6D4CF]">
              {data.todayMarked} of {data.todayTotal} marked across {data.todaysLanes.length}{" "}
              {data.todaysLanes.length === 1 ? "session" : "sessions"}
            </p>
          </>
        ) : (
          <p className="mt-1.5 text-[15px] font-medium text-white">Nothing scheduled today</p>
        )}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <div className="rounded-ctl bg-deck px-2.5 py-3">
          <p className="font-display text-[17px] font-semibold tracking-tight">{data.activeMemberCount}</p>
          <p className="mt-0.5 text-[11px] text-ink-3">Active members</p>
        </div>
        <div className="rounded-ctl bg-deck px-2.5 py-3">
          <p className="font-display text-[17px] font-semibold tracking-tight">
            {data.attendanceThisWeekPct === null ? "—" : `${data.attendanceThisWeekPct}%`}
          </p>
          <p className="mt-0.5 text-[11px] text-ink-3">Attendance this week</p>
        </div>
        <div className="rounded-ctl bg-deck px-2.5 py-3">
          <p className="font-display text-[17px] font-semibold tracking-tight">{data.activeBatchCount}</p>
          <p className="mt-0.5 text-[11px] text-ink-3">Batches running</p>
        </div>
      </div>

      <h2 className="font-display text-[15px] font-semibold mt-7 mb-2.5">Needs you today</h2>
      {data.needsAttention.length === 0 ? (
        <div className="rounded-ctl border border-line bg-paper px-4 py-6 text-center">
          <p className="text-[13px] text-ink-3">Nothing needs attention right now.</p>
        </div>
      ) : (
        <ul>
          {data.needsAttention.map((item, i) => (
            <li
              key={i}
              className="flex items-center gap-3 bg-paper border border-line rounded-ctl px-3.5 py-3 mb-2"
            >
              <div className="h-9 w-9 rounded-[11px] bg-warn-soft text-warn grid place-items-center flex-none">
                <AlertTriangle size={16} strokeWidth={2} />
              </div>
              <div className="min-w-0">
                <p className="text-[14px] font-medium leading-tight">{item.title}</p>
                <p className="mt-0.5 text-[12px] text-ink-3 leading-tight truncate">{item.detail}</p>
              </div>
              <ChevronRight size={18} className="ml-auto text-ink-3 flex-none" />
            </li>
          ))}
        </ul>
      )}

      <h2 className="font-display text-[15px] font-semibold mt-7 mb-2.5">Today&apos;s lanes</h2>
      {data.todaysLanes.length === 0 ? (
        <div className="rounded-ctl border border-line bg-paper px-4 py-6 text-center">
          <p className="text-[13px] font-medium">No sessions today</p>
          <p className="mt-1 text-[12.5px] text-ink-3">
            Nothing is scheduled for today across any batch.
          </p>
        </div>
      ) : (
        data.todaysLanes.map((lane) => {
          const fillPct = lane.capacity > 0 ? Math.min(100, Math.round((lane.enrolled / lane.capacity) * 100)) : 0;
          // water normally, warn under half full — DESIGN.md's lane
          // strip rule ("water normally, warn when under-filled, late
          // when a problem"); no "problem" state is detectable from
          // today's schema (an overbooked batch can't happen, C-18
          // enforces capacity at enrolment), so only the first two apply.
          const fillColor = fillPct < 50 ? "bg-warn" : "bg-water";
          return (
            <div key={lane.batchId} className="bg-paper border border-line rounded-card px-4 py-3.5 mb-2.5" data-testid="owner-lane">
              <div className="flex justify-between items-baseline mb-2.5">
                <div>
                  <div className="font-display text-[15px] font-semibold flex items-center gap-1.5">
                    <Clock size={13} className="text-ink-3" />
                    {lane.startTime.slice(0, 5)} {lane.batchName}
                  </div>
                  <div className="text-[12.5px] text-ink-3 mt-0.5">{lane.programName}</div>
                </div>
                <div className="font-display text-[15px] font-semibold">
                  {lane.enrolled}
                  <span className="text-ink-3 font-normal">/{lane.capacity}</span>
                </div>
              </div>
              <div className="h-1.5 rounded-pill bg-deck overflow-hidden">
                <div className={`h-full rounded-pill ${fillColor}`} style={{ width: `${fillPct}%` }} />
              </div>
            </div>
          );
        })
      )}
    </main>
  );
}
