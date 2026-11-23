import { SegmentedTabs } from "@/components/ui/SegmentedTabs";
import type { ScheduleSurface } from "@/lib/owner-scope/schedule";

// Audit simplification (21 November 2026) — Calendar / List is the one
// switch between the two presentations of the single Schedule job. It
// renders only when BOTH surfaces are permitted, so it never offers a
// destination the caller's grants cannot open (a disabled tab is still
// a dead end, and the audit asked for no dead ends).
//
// The switch is real document navigation (`<a href>` plus
// `aria-current="page"`), not client tabs: the URL, a refresh and the
// browser Back button all keep the owner on the surface they chose,
// and it works without JavaScript.
export function ScheduleSurfaceSwitch({
  active,
  calendarHref,
  listHref,
}: {
  active: ScheduleSurface;
  /** Present only when the caller may open the calendar. */
  calendarHref?: string;
  /** Present only when the caller may open the exception list. */
  listHref?: string;
}) {
  if (!calendarHref || !listHref) return null;
  return (
    <SegmentedTabs
      ariaLabel="Schedule views"
      documentNavigation
      active={active}
      tabs={[
        { key: "calendar", label: "Calendar", href: calendarHref },
        { key: "list", label: "List", href: listHref },
      ]}
    />
  );
}
