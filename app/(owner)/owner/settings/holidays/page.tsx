import { listHolidaysAction } from "@/lib/actions/holidays";
import { HolidaysBoard } from "@/components/holidays-board";
import { requireOwner } from "@/lib/auth/surface-guard";
import { BackLink } from "@/components/ui/BackLink";

// R.3 (docs/five-day-work-guide.md) — the owner-facing holiday and
// closure calendar. The generator already consults tenant_holidays;
// this page is where the owner declares them.
export default async function HolidaysPage() {
  await requireOwner();
  const holidays = await listHolidaysAction();

  return (
    <main className="px-5 pt-6 pb-8">
      <BackLink href="/owner/settings" label="Settings" />
      <h1 className="font-display text-[19px] font-semibold">
        Holidays &amp; closures
      </h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        No sessions are generated on these dates — a national holiday
        won&apos;t leave a coach with an empty register. Recurring
        holidays repeat every year on the same date.
      </p>
      <div className="mt-4">
        <HolidaysBoard initialHolidays={holidays} />
      </div>
    </main>
  );
}
