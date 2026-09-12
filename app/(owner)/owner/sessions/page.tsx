import Link from "next/link";
import { ArrowLeft, UserCog } from "lucide-react";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import { listUpcomingSessions } from "@/lib/services/coach-schedule";
import { listCoaches } from "@/lib/services/programs";
import { listBatches } from "@/lib/services/programs";
import { UpcomingSessionsList } from "@/components/upcoming-sessions-list";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { requireOwner } from "@/lib/auth/surface-guard";

// F3 (R.1) — owner-facing upcoming-sessions page. Lists every
// scheduled session in the tenant over the next two weeks, with
// its current coach and a per-row substitute control. This is
// the surface the audit's R.1 promised ("Coach substitution —
// records who actually took the session. ... If substitution
// does not write the substitute, the wrong coach is paid and
// the bug is invisible from the register surface.") and that
// did not exist before this commit — the action existed, the
// service existed, but the user could not reach them.
//
// Permission: management-only (owner / admin). The session
// data includes substitute buttons that mutate production data;
// coaches use the existing coach-side surfaces (their schedule
// page lists their own sessions and uses them).

export default async function SessionsPage() {
  await requireOwner();
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "attendance.read");

  const today = new Date();
  const twoWeeksOut = new Date();
  twoWeeksOut.setUTCDate(twoWeeksOut.getUTCDate() + 14);
  const fromDate = today.toISOString().slice(0, 10);
  const toDate = twoWeeksOut.toISOString().slice(0, 10);

  const [upcoming, coaches, terminology] = await Promise.all([
    listUpcomingSessions(ctx, fromDate, toDate),
    listCoaches(ctx),
    // The substitute coach picker labels itself with closed-key
    // `coach` (L3 audit). Fetching once at the page so the
    // UpcomingSessionsList → SessionSubstituteControl prop
    // drill is just data, not extra round trips.
    getTerminologyAction(),
  ]);

  // unused here, but importing keeps the export live for tests
  // that may assert the page resolves both lists.
  void listBatches;

  return (
    <main className="px-5 pt-6 pb-8">
      <Link
        href="/owner/programs"
        className="inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink mb-4"
      >
        <ArrowLeft size={16} />
        Programs
      </Link>

      <div className="flex items-center gap-2">
        <UserCog size={20} className="text-ink-2" />
        <h1 className="font-display text-[19px] font-semibold">Sessions</h1>
      </div>
      <p className="mt-1 text-[12.5px] text-ink-3">
        Upcoming sessions across every batch — substitute a coach when
        someone is unavailable. The change is recorded so the register
        reads who actually ran the session.
      </p>

      <UpcomingSessionsList initialSessions={upcoming} coaches={coaches} terminology={terminology} />

      <div className="mt-6 rounded-card border border-line bg-paper p-4">
        <p className="text-[12.5px] text-ink-3">
          Showing the next 14 days. Cancel or reschedule a session from
          the program board; reschedules guard against coach conflicts
          before they save.
        </p>
      </div>
    </main>
  );
}
