"use client";

import { useState, type ReactNode } from "react";
import ListFilter from "lucide-react/dist/esm/icons/list-filter.mjs";
import { Dialog } from "@/components/ui/Dialog";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { ScheduleDatePicker } from "./schedule-date-picker";

type PlannerView = "day" | "week" | "month" | "agenda";

export function OwnerPlannerControls({
  date, view, locationId, scopeLabel, rangeLabel, shortRange,
  prevHref, nextHref, todayHref, filters,
}: {
  date: string;
  view: PlannerView;
  locationId?: string;
  scopeLabel: string;
  rangeLabel: string;
  shortRange: string;
  prevHref: string;
  nextHref: string;
  todayHref: string;
  filters: ReactNode;
}) {
  const [sheet, setSheet] = useState<"date" | "filters" | null>(null);
  const period = view === "agenda" ? "week" : view;
  const viewName = view[0].toUpperCase() + view.slice(1);

  return (
    <>
      <div className="owner-planner-controls" aria-label="Schedule date and filters" role="group">
        <a href={prevHref} className="owner-planner-control" aria-label={`Previous ${period}`} data-testid="calendar-previous">
          <OwnerIcon name="left" size={17} />
        </a>
        <button type="button" className="owner-planner-range" onClick={() => setSheet("date")}
          aria-label={`Jump to date, ${rangeLabel}, ${scopeLabel}`} aria-haspopup="dialog">
          <span className="owner-planner-range-copy">
            <strong data-testid="calendar-range">{shortRange}</strong>
            <span title={scopeLabel}>{scopeLabel} · {viewName}</span>
          </span>
          <OwnerIcon name="down" size={14} />
        </button>
        <a href={nextHref} className="owner-planner-control" aria-label={`Next ${period}`} data-testid="calendar-next">
          <OwnerIcon name="chevron" size={17} />
        </a>
        <button type="button" className="owner-planner-control" onClick={() => setSheet("filters")}
          aria-label="Schedule filters" aria-haspopup="dialog">
          <ListFilter size={19} aria-hidden="true" />
        </button>
      </div>
      <Dialog open={sheet === "date"} onOpenChange={open => { if (!open) setSheet(null); }}
        title="Jump to date" description={scopeLabel} className="owner-planner-sheet" swipeToClose>
        <div className="owner-schedule-date-sheet grid items-start gap-3">
          <ScheduleDatePicker date={date} view={view} locationId={locationId} />
          <a href={todayHref} className="owner-planner-today" data-testid="calendar-today">Today</a>
        </div>
      </Dialog>
      <Dialog open={sheet === "filters"} onOpenChange={open => { if (!open) setSheet(null); }}
        title="Schedule filters" description={scopeLabel} className="owner-planner-sheet" swipeToClose>
        {filters}
      </Dialog>
    </>
  );
}
