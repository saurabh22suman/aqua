import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { requireDefaultCtx } from "@/lib/auth/context";
import { hasPermission } from "@/lib/auth/permission";
import { listUpcomingSessions } from "@/lib/services/coach-schedule";
import { listCoaches } from "@/lib/services/programs";
import { UpcomingSessionsList } from "@/components/upcoming-sessions-list";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { getTenantTimezoneAction } from "@/lib/actions/tenant-timezone";
import { daysAheadWindow } from "@/lib/time/tz";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { buttonClasses } from "@/components/ui/Button";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { BackLink } from "@/components/ui/BackLink";

// F3 (R.1) — owner-facing upcoming-sessions page. Lists every
// scheduled session in the tenant over the next two weeks, with
// its current coach and a per-row substitute control. This is
// the surface the audit's R.1 promised ("Coach substitution —
// records who actually took the session. ... If substitution
// does not write the substitute, the wrong coach is paid and
// the bug is invisible from the register surface.").
//
// Owner OpenPen (29 October 2026): exception management leads; the
// schedule grid is a secondary destination in the heading action slot.
// Permission: management-only (owner / admin).

export default async function SessionsPage() {
  await requireOwner();
  const ctx = await requireDefaultCtx();
  requirePagePermission(ctx, "programs.write");

  const timezone = await getTenantTimezoneAction();
  const { fromDate, toDate } = daysAheadWindow(timezone, 14);

  const [upcoming, coaches, terminology] = await Promise.all([
    listUpcomingSessions(ctx, fromDate, toDate),
    listCoaches(ctx),
    // The substitute coach picker labels itself with closed-key
    // `coach` (L3 audit).
    getTerminologyAction(),
  ]);

  return (
    <OwnerPage>
      <BackLink href="/owner/programs" label="Programs & batches" />
      <PageHeader
        title="Session exceptions"
        purpose="Today and the next 14 days. Substitute a coach when someone is unavailable; the register then shows who actually ran the session."
        action={
          hasPermission(ctx, "attendance.read") ? (
            <Link
              href="/owner/schedule"
              className={buttonClasses({ variant: "secondary", size: "sm" })}
            >
              <CalendarDays size={15} className="text-ink-3" aria-hidden="true" />
              Schedule grid
            </Link>
          ) : null
        }
      />

      <div className="mt-5">
        <UpcomingSessionsList
          initialSessions={upcoming}
          coaches={coaches}
          terminology={terminology}
          timezone={timezone}
          canManage={hasPermission(ctx, "programs.write")}
        />
      </div>
    </OwnerPage>
  );
}
