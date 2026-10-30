import Link from "next/link";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { getTenantTimezoneAction } from "@/lib/actions/tenant-timezone";
import { listLocationsAction } from "@/lib/actions/people";
import { listStaffAction } from "@/lib/actions/staff";
import {
  listRosterWeekAction,
  listShiftTemplatesAction,
} from "@/lib/actions/shifts";
import { addDays, formatWeekdayDateIST, todayInZone, weekdayOf } from "@/lib/time/tz";
import { Button, buttonClasses } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Select } from "@/components/ui/Select";
import { StaffRosterBoard } from "@/components/staff-roster-board";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";

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
  requirePagePermission(ctx, "staff.roster");

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
    <OwnerPage>
      <PageHeader
        title={<>Roster</>}
        purpose={<>Build the week and publish it when it is ready. Staff see their
        published shifts on the Me tab.</>}
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link
          href={base(addDays(weekStart, -7))}
          className={buttonClasses({ variant: "secondary", size: "md" })}
        >
          Previous week
        </Link>
        <Link
          href={base(todayInZone(timezone))}
          className={buttonClasses({ variant: "secondary", size: "md" })}
        >
          Today
        </Link>
        <Link
          href={base(addDays(weekStart, 7))}
          className={buttonClasses({ variant: "secondary", size: "md" })}
        >
          Next week
        </Link>
        <Link
          href="/owner/staff/leave"
          className={buttonClasses({ variant: "secondary", size: "md" })}
        >
          Leave requests
        </Link>
        <Link
          href="/owner/staff/check-in-qr"
          className={buttonClasses({ variant: "secondary", size: "md" })}
        >
          Check-in poster
        </Link>
      </div>

      {locations.length > 1 ? (
        <form method="get" className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="week" value={weekStart} />
          <Field id="roster-location" label="Location">
            {() => (
              <Select
                id="roster-location"
                name="location"
                defaultValue={locationId ?? ""}
              >
                <option value="">All locations</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {/* P2 (independent review) — a standard form action beside a
              shared control is the shared STANDARD control (48px, the
              10px radius, 16px text), not the old 44px pill. */}
          <Button type="submit" variant="primary" size="md" data-testid="roster-apply">
            Apply
          </Button>
        </form>
      ) : null}

      <section className="mt-5 rounded-card border border-line bg-paper p-5">
        <h2 className="font-display text-[16px] font-semibold text-ink">
          Working week
        </h2>
        <p className="mt-0.5 text-[12.5px] text-ink-3">
          Week of {formatWeekdayDateIST(`${weekStart}T12:00:00Z`)} · {timezone}
          {locationId
            ? ` · ${locations.find((l) => l.id === locationId)?.name ?? "Selected location"}`
            : ""}
        </p>
        <StaffRosterBoard
          weekStart={weekStart}
          shifts={shifts}
          templates={templates}
          staff={staff}
          locations={locations}
          weekLocationId={locationId ?? null}
        />
      </section>
    </OwnerPage>
  );
}
