import type { ReactNode } from "react";
import { CalendarNavControl } from "@/components/owner-calendar/owner-calendar-nav";
import type { CalendarNavTarget } from "@/components/owner-calendar/owner-calendar-types";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { OwnerControlSheet } from "@/components/owner-ui/owner-control-sheet";

export function OwnerPeriodStrip({ label, value, period, previous, next, children, immediate = false }: {
  label: string;
  value: string;
  period: "day" | "week";
  previous: CalendarNavTarget;
  next: CalendarNavTarget;
  children: ReactNode;
  immediate?: boolean;
}) {
  return <nav className="owner-period-strip" aria-label={label}>
    <CalendarNavControl target={previous} ariaLabel={`Previous ${period}`} testId="calendar-previous">
      <OwnerIcon name="left" size={17} />
    </CalendarNavControl>
    <OwnerControlSheet label={label} value={value} immediate={immediate} alwaysSheet>{children}</OwnerControlSheet>
    <CalendarNavControl target={next} ariaLabel={`Next ${period}`} testId="calendar-next">
      <OwnerIcon name="chevron" size={17} />
    </CalendarNavControl>
  </nav>;
}
