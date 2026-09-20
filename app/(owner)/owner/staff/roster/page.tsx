import Link from "next/link";
import { requireOwner } from "@/lib/auth/surface-guard";
import { requirePermission } from "@/lib/auth/permission";
import { getTenantTimezoneAction } from "@/lib/actions/tenant-timezone";
import { listLocationsAction } from "@/lib/actions/people";
import { listStaffAction } from "@/lib/actions/staff";
import {
  listRosterWeekAction,
  listShiftTemplatesAction,
} from "@/lib/actions/shifts";
import { addDays, todayInZone, weekdayOf } from "@/lib/time/tz";
import { BackLink } from "@/components/ui/BackLink";
import { StaffRosterBoard } from "@/components/staff-roster-board";

// V-23 — the owner's weekly roster builder. Draft shifts are built
// here and published as a week; until publication they are invisible
// to the staff member they belong to (lib/services/shifts.ts).
//
// The week is Monday-first and navigation is link/searchParams-driven,
// matching /owner/schedule: no client state for the frame, so the
// page stays a server component except the mutation island.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function clampAnchor(value: string | undefined, fallback: string): string {
  return value && DATE_RE.test(value) ? value : fallback;
}

function mondayOf(date: string): string {
  const dow = weekdayOf(date);
  return addDays(date, -(dow === 0 ? 6 : dow - 1));
}

export default async function StaffRosterPage({
  searchParams,
}: {
  searchParams?: Promise<{ week?: string; location?: string }>;
}) {
  const ctx = await requireOwner();
  requirePermission(ctx, "staff.roster");

  const params = searchParams ? await searchParams : {};
  const timezone = await getTenantTimezoneAction();
  const weekStart = mondayOf(clampAnchor(params.week, todayInZone(timezone)));
  const weekEnd = addDays(weekStart, 6);
  const locationId = params.location;

  const [shifts, templates, staff, locations] = await Promise.all([
    listRosterWeekAction({
      fromDate: weekStart,
      toDate: weekEnd,
      ...(locationId ? { locationId } : {}),
    }),
    listShiftTemplatesAction(locationId ? { locationId } : {}),
    listStaffAction({}),
    listLocationsAction(),
  ]);

  const base = (date: string) =>
    `/owner/staff/roster?week=${date}${locationId ? `&location=${locationId}` : ""}`;

  return (
    <main className="px-5 pt-6 pb-8">
      <BackLink href="/owner/staff" label="Staff" />
      <h1 className="mt-2 font-display text-[19px] font-semibold">Roster</h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        Week of {weekStart} ({timezone}). Publish the week when it is
        ready — staff see their shifts on the Me tab.
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href="/owner/staff/check-in-qr"
          className="inline-flex min-h-[44px] items-center rounded-ctl border border-line bg-paper px-3 text-[13px]"
        >
          Premises check-in QR →
        </Link>
        <Link
          href="/owner/staff/leave"
          className="inline-flex min-h-[44px] items-center rounded-ctl border border-line bg-paper px-3 text-[13px]"
        >
          Leave requests →
        </Link>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link
          href={base(addDays(weekStart, -7))}
          className="flex min-h-[44px] items-center rounded-ctl border border-line bg-paper px-3 text-[13px]"
        >
          ← Prev
        </Link>
        <Link
          href={base(todayInZone(timezone))}
          className="flex min-h-[44px] items-center rounded-ctl border border-line bg-paper px-3 text-[13px]"
        >
          Today
        </Link>
        <Link
          href={base(addDays(weekStart, 7))}
          className="flex min-h-[44px] items-center rounded-ctl border border-line bg-paper px-3 text-[13px]"
        >
          Next →
        </Link>
      </div>

      {locations.length > 1 ? (
        <form method="get" className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="week" value={weekStart} />
          <label className="block">
            <span className="mb-0.5 block text-[11px] text-ink-3">Location</span>
            <select
              name="location"
              defaultValue={locationId ?? ""}
              className="min-h-[44px] rounded-ctl border border-line bg-paper px-3 text-[16px] text-ink focus:border-[var(--accent)] focus:outline-none"
            >
              <option value="">All locations</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="min-h-[44px] rounded-pill bg-[var(--accent)] px-4 text-[13px] font-semibold text-paper"
          >
            Apply
          </button>
        </form>
      ) : null}

      <StaffRosterBoard
        weekStart={weekStart}
        shifts={shifts}
        templates={templates}
        staff={staff}
        locations={locations}
        defaultLocationId={locationId ?? locations[0]?.id ?? null}
      />
    </main>
  );
}
