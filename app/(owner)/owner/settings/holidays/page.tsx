import { requireLiveOwnerSettingsPage } from "@/lib/auth/owner-settings-page-guard";
import { listHolidaysAction } from "@/lib/actions/holidays";
import { HolidaysBoard } from "@/components/holidays-board";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { BackLink } from "@/components/ui/BackLink";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PageHeader } from "@/components/ui/PageHeader";
import { reviewClosureAction } from "@/lib/actions/closure-review";
import { hasPermission } from "@/lib/auth/permission";

// R.3 (docs/five-day-work-guide.md) — the owner-facing holiday and
// closure calendar. The generator already consults tenant_holidays;
// this page is where the owner declares them.
//
// 3 November 2026: the page's own purpose line no longer repeats the
// board's promise. The single statement that sessions which were ALREADY
// generated are not cancelled stays in `components/holidays-board.tsx`,
// which owns that warning; this page must not duplicate it.
export default async function HolidaysPage() {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "settings.manage");
  await requireLiveOwnerSettingsPage(ctx);
  const holidays = await listHolidaysAction();
  const reviewed = await Promise.all(holidays.slice(0,50).map((holiday) => reviewClosureAction(holiday.id).catch(() => null)));
  const reviews = Object.fromEntries(reviewed.filter((review) => review !== null).map((review) => [review.holidayId,review]));

  return (
    <OwnerPage>
      <BackLink href="/owner/settings" label="Settings" />
      <PageHeader
        title={<>Holidays &amp; closures</>}
        purpose={<>No sessions are generated on these dates. Recurring holidays
        repeat every year on the same date.</>}
      />
      <div className="mt-4">
        <HolidaysBoard initialHolidays={holidays} reviews={reviews} canManageSessions={hasPermission(ctx,"programs.write")} />
      </div>
    </OwnerPage>
  );
}
