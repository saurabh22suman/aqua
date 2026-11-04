// @vitest-environment jsdom
//
// Ops redesign (28 October 2026; revised 31 October 2026) — the
// activity filter's date bounds.
//
// The pre-freeze review found a real defect in the new filter:
//
//   - The relative ranges serialized a FULL ISO TIMESTAMP into the
//     query, but the visible controls were `<input type="date">`.
//     Chrome rejects an ISO timestamp as a date value, so after Apply
//     (or from a shared URL) the date fields painted BLANK — the
//     filter looked like it had been cleared while a bound was still
//     active.
//   - A URL that carried bounds still showed "Any time", so the
//     operator could not see that a bound was set — and choosing
//     "Any time" did not clear the bounds it claimed to clear.
//
// REVISED (human revision, 31 October 2026): the filter asks for
// DATES, not for instants. There is no hour, no minute, no AM/PM and no
// seconds control; the date is CHOSEN from the shared calendar and the
// query carries the canonical `yyyy-mm-dd`.
//
// The contract for the filter:
//
//   - The range choices are date ranges: Any date, Today, Last 7 days,
//     Last 30 days, Custom. There is no rolling "last 24 hours".
//   - A URL that carries bounds shows "Custom", never "Any date".
//   - Choosing "Any date" clears the bounds.
//   - A relative range shows its TRUTHFUL visible bounds — the same
//     calendar dates it puts in the query.
//   - The start is never after the end, and an unreadable bound is
//     refused.
//   - A legacy timestamp link is normalised to the IST date it names.
//
// The helpers are accessed through the module namespace so this file
// fails with a readable assertion — not an import error — before they
// exist.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as filter from "@/components/ops/ops-activity-filter";
import { addDays, todayInZone } from "@/lib/time/tz";
import { calendarTrigger, dayCell } from "@/tests/app-wide-ux-20261031/calendar-probe";

type FilterModule = typeof filter & {
  activityDateRangeBounds?: (
    range: string,
    now?: Date,
  ) => { since: string; until: string } | null;
  normalizeActivityDate?: (value: string | undefined) => string | null;
  buildActivityDateQuery?: (
    state: {
      action: string;
      tenantId: string;
      range: string;
      sinceDate: string;
      untilDate: string;
    },
    now?: Date,
  ) => { ok: true; query: string } | { ok: false; error: string };
};

const mod = filter as FilterModule;

const TENANTS = [
  { id: "t1", name: "Aqua Worli", slug: "aqua-worli" },
  { id: "t2", name: "Blue Wave Academy", slug: "bluewave" },
];

const TZ = "Asia/Kolkata";

beforeEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { search: "" },
  });
});

afterEach(cleanup);

function renderFilter(initial: {
  action?: string;
  tenantId?: string;
  since?: string;
  until?: string;
}) {
  return render(
    <filter.OpsActivityFilter
      actions={["tenant.activate", "tenant.suspend"]}
      tenants={TENANTS}
      initial={initial}
    />,
  );
}

function control(name: RegExp) {
  return screen.getByRole("combobox", { name }) as HTMLSelectElement;
}

describe("Activity filter — the visible bounds", () => {
  it("shows Custom, not Any date, when the URL carries bounds", () => {
    renderFilter({ since: "2026-10-28", until: "2026-10-29" });
    expect(control(/range/i).value).toBe("custom");
  });

  it("shows Any date when the URL carries no bounds", () => {
    renderFilter({});
    expect(control(/range/i).value).toBe("");
  });

  it("offers date ranges, never a rolling 24 hours", () => {
    renderFilter({});
    const choices = within(control(/range/i))
      .getAllByRole("option")
      .map((option) => (option.textContent ?? "").trim());
    expect(choices).toEqual([
      "Any date",
      "Today",
      "Last 7 days",
      "Last 30 days",
      "Custom",
    ]);
  });

  it("shows an inbound timestamp as the IST calendar date it names", () => {
    // 12:00Z is 17:30 IST — the operator works in IST.
    renderFilter({ since: "2026-10-28T12:00:00Z" });
    expect(screen.getByLabelText<HTMLInputElement>(/since date/i)).toHaveProperty(
      "value",
      "28/10/2026",
    );
  });

  it("shows a bound chosen from the calendar", () => {
    renderFilter({});
    const trigger = calendarTrigger(document.body);
    expect(trigger, "the filter's date field offers no calendar").toBeTruthy();
    fireEvent.click(trigger!);
    const day = dayCell(document.body, 15);
    expect(day, "the calendar has no day 15").toBeTruthy();
    fireEvent.click(day!);
    expect(
      screen.getByLabelText<HTMLInputElement>(/since date/i).value,
    ).not.toBe("");
  });
});

describe("Activity filter — the query it builds", () => {
  const state = {
    action: "",
    tenantId: "",
    range: "",
    sinceDate: "",
    untilDate: "",
  };

  it("builds no date bounds for Any date", () => {
    expect(mod.buildActivityDateQuery).toBeDefined();
    const result = mod.buildActivityDateQuery!({
      ...state,
      range: "",
      sinceDate: "2026-10-01",
      untilDate: "2026-10-05",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.query).not.toContain("since");
      expect(result.query).not.toContain("until");
    }
  });

  it("serializes the manual bounds as calendar dates", () => {
    expect(mod.buildActivityDateQuery).toBeDefined();
    const result = mod.buildActivityDateQuery!({
      ...state,
      range: "custom",
      sinceDate: "2026-10-28",
      untilDate: "2026-10-29",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.query).toContain("since=2026-10-28");
      expect(result.query).toContain("until=2026-10-29");
      // A date, never an instant.
      expect(result.query).not.toMatch(/T\d{2}%3A/);
    }
  });

  it("refuses a start that is after the end", () => {
    expect(mod.buildActivityDateQuery).toBeDefined();
    const result = mod.buildActivityDateQuery!({
      ...state,
      range: "custom",
      sinceDate: "2026-10-28",
      untilDate: "2026-10-27",
    });
    expect(result.ok).toBe(false);
  });

  it("refuses a date that is not a real calendar day", () => {
    expect(mod.buildActivityDateQuery).toBeDefined();
    const result = mod.buildActivityDateQuery!({
      ...state,
      range: "custom",
      sinceDate: "2026-02-30",
      untilDate: "",
    });
    expect(result.ok).toBe(false);
  });

  it("gives a relative range truthful bounds, and the same bounds it serializes", () => {
    expect(mod.activityDateRangeBounds).toBeDefined();
    const now = new Date("2026-10-28T12:00:00Z");
    const bounds = mod.activityDateRangeBounds!("7d", now)!;
    expect(bounds).not.toBeNull();
    // Today and the six IST dates before it.
    expect(bounds.until).toBe("2026-10-28");
    expect(bounds.since).toBe("2026-10-22");
    // And the query carries the same calendar dates.
    const result = mod.buildActivityDateQuery!({ ...state, range: "7d" }, now);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.query).toContain(`since=${bounds.since}`);
      expect(result.query).toContain(`until=${bounds.until}`);
    }
  });

  it("normalises a legacy timestamp to the IST date it names", () => {
    expect(mod.normalizeActivityDate).toBeDefined();
    expect(mod.normalizeActivityDate!("2026-10-28T12:00:00Z")).toBe("2026-10-28");
    expect(mod.normalizeActivityDate!("2026-10-28")).toBe("2026-10-28");
    // A day that does not exist is refused, not rolled over.
    expect(mod.normalizeActivityDate!("2026-02-30")).toBeNull();
    expect(mod.normalizeActivityDate!("not-a-date")).toBeNull();
  });
});

describe("Activity filter — the controls", () => {
  it("clears the bounds when Any date is chosen", () => {
    renderFilter({ since: "2026-10-28", until: "2026-10-29" });
    fireEvent.change(control(/range/i), { target: { value: "" } });
    expect(screen.getByLabelText<HTMLInputElement>(/since date/i)).toHaveProperty("value", "");
    expect(screen.getByLabelText<HTMLInputElement>(/until date/i)).toHaveProperty("value", "");
  });

  it("shows the truthful bounds of a relative range in the date fields", () => {
    renderFilter({});
    fireEvent.change(control(/range/i), { target: { value: "7d" } });
    const today = todayInZone(TZ);
    expect(screen.getByLabelText<HTMLInputElement>(/since date/i).value).toBe(
      addDays(today, -6).split("-").reverse().join("/"),
    );
    expect(screen.getByLabelText<HTMLInputElement>(/until date/i).value).toBe(
      today.split("-").reverse().join("/"),
    );
  });

  it("offers the tenant by name, not by a free-text id", () => {
    renderFilter({});
    const tenant = control(/tenant/i);
    const options = within(tenant)
      .getAllByRole("option")
      .map((option) => option.textContent ?? "");
    expect(options.join(" ")).toContain("Aqua Worli");
  });
});
