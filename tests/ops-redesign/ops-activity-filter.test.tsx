// @vitest-environment jsdom
//
// Ops redesign (28 October 2026) — the activity filter's date bounds.
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
// The fix is in the Ops UI only: the backend's date filter is
// unchanged, and no date library is added.
//
// The contract for the filter:
//
//   - The bounds are EXPLICIT date + time inputs, labelled IST, so
//     the operator sees exactly which instants the query carries.
//   - A URL that carries bounds shows "Custom", never "Any time".
//   - Choosing "Any time" clears the bounds.
//   - A relative range shows its TRUTHFUL visible bounds — the same
//     instants it puts in the query.
//   - The start is never after the end.
//   - An inbound timestamp keeps its instant: it is shown in IST and
//     serialized back with the IST offset, so a shared URL reloads to
//     the same filter.
//
// The helpers are accessed through the module namespace so this file
// fails with a readable assertion — not an import error — before they
// exist.

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import * as filter from "@/components/ops/ops-activity-filter";

type FilterModule = typeof filter & {
  activityRangeBounds?: (
    range: string,
    now?: Date,
  ) => { since: string; until: string } | null;
  formatIstParts?: (
    iso: string,
  ) => { date: string; time: string } | null;
  buildIstTimestamp?: (date: string, time: string) => string | null;
  buildActivityQuery?: (
    state: {
      action: string;
      tenantId: string;
      range: string;
      sinceDate: string;
      sinceTime: string;
      untilDate: string;
      untilTime: string;
    },
    now?: Date,
  ) => { ok: true; query: string } | { ok: false; error: string };
};

const mod = filter as FilterModule;

const TENANTS = [
  { id: "t1", name: "Aqua Worli", slug: "aqua-worli" },
  { id: "t2", name: "Blue Wave Academy", slug: "bluewave" },
];

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
  it("shows Custom, not Any time, when the URL carries bounds", () => {
    renderFilter({
      since: "2026-10-28T12:00:00+05:30",
      until: "2026-10-28T18:00:00+05:30",
    });
    expect(control(/range/i).value).toBe("custom");
  });

  it("shows Any time when the URL carries no bounds", () => {
    renderFilter({});
    expect(control(/range/i).value).toBe("");
  });

  it("shows an inbound timestamp as its IST date and time, and keeps the instant", () => {
    renderFilter({ since: "2026-10-28T12:00:00+05:30" });
    expect(screen.getByLabelText<HTMLInputElement>(/since date/i)).toHaveProperty(
      "value",
      "2026-10-28",
    );
    expect(screen.getByLabelText<HTMLInputElement>(/since time/i)).toHaveProperty(
      "value",
      "12:00:00",
    );
  });

  it("shows a UTC timestamp in IST, not in UTC", () => {
    // 12:00Z is 17:30 IST — the operator works in IST.
    renderFilter({ since: "2026-10-28T12:00:00Z" });
    expect(screen.getByLabelText<HTMLInputElement>(/since date/i)).toHaveProperty(
      "value",
      "2026-10-28",
    );
    expect(screen.getByLabelText<HTMLInputElement>(/since time/i)).toHaveProperty(
      "value",
      "17:30:00",
    );
  });
});

describe("Activity filter — the query it builds", () => {
  const state = {
    action: "",
    tenantId: "",
    range: "",
    sinceDate: "",
    sinceTime: "",
    untilDate: "",
    untilTime: "",
  };

  it("builds no date bounds for Any time", () => {
    expect(mod.buildActivityQuery).toBeDefined();
    const result = mod.buildActivityQuery!({
      ...state,
      range: "",
      sinceDate: "2026-10-01",
      sinceTime: "09:00:00",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.query).not.toContain("since");
      expect(result.query).not.toContain("until");
    }
  });

  it("serializes the manual bounds as offset-aware IST timestamps", () => {
    expect(mod.buildActivityQuery).toBeDefined();
    const result = mod.buildActivityQuery!({
      ...state,
      range: "custom",
      sinceDate: "2026-10-28",
      sinceTime: "17:30:00",
      untilDate: "2026-10-28",
      untilTime: "18:45:00",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.query).toContain("since=2026-10-28T17%3A30%3A00%2B05%3A30");
      expect(result.query).toContain("until=2026-10-28T18%3A45%3A00%2B05%3A30");
    }
  });

  it("refuses a start that is after the end", () => {
    expect(mod.buildActivityQuery).toBeDefined();
    const result = mod.buildActivityQuery!({
      ...state,
      range: "custom",
      sinceDate: "2026-10-28",
      sinceTime: "19:00:00",
      untilDate: "2026-10-28",
      untilTime: "18:00:00",
    });
    expect(result.ok).toBe(false);
  });

  it("gives a relative range truthful bounds, and the same bounds it serializes", () => {
    expect(mod.activityRangeBounds).toBeDefined();
    const now = new Date("2026-10-28T12:00:00Z");
    const bounds = mod.activityRangeBounds!("24h", now)!;
    expect(bounds).not.toBeNull();
    // The visible bound is the IST rendering of the serialized instant.
    const parts = mod.formatIstParts!(bounds.since)!;
    // 2026-10-28T12:00Z minus 24 hours is 2026-10-27T12:00Z, which is
    // 17:30 IST — the same instant, shown in the operator's zone.
    expect(parts.date).toBe("2026-10-27");
    expect(parts.time).toBe("17:30:00");
    // And the query carries the same instant.
    const result = mod.buildActivityQuery!({ ...state, range: "24h" }, now);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.query).toContain(
        `since=${encodeURIComponent(bounds.since)}`,
      );
    }
  });

  it("keeps an inbound timestamp's instant through a display round trip", () => {
    expect(mod.formatIstParts).toBeDefined();
    expect(mod.buildIstTimestamp).toBeDefined();
    const parts = mod.formatIstParts!("2026-10-28T12:00:00+05:30")!;
    expect(parts).toEqual({ date: "2026-10-28", time: "12:00:00" });
    expect(mod.buildIstTimestamp!(parts.date, parts.time)).toBe(
      "2026-10-28T12:00:00+05:30",
    );
  });
});

describe("Activity filter — the controls", () => {
  it("clears the bounds when Any time is chosen", () => {
    renderFilter({
      since: "2026-10-28T12:00:00+05:30",
      until: "2026-10-28T18:00:00+05:30",
    });
    const range = control(/range/i);
    fireEvent.change(range, { target: { value: "" } });
    expect(screen.getByLabelText<HTMLInputElement>(/since date/i)).toHaveProperty("value", "");
    expect(screen.getByLabelText(/until date/i)).toHaveProperty("value", "");
  });

  it("shows the truthful bounds of a relative range in the date and time fields", () => {
    renderFilter({});
    fireEvent.change(control(/range/i), { target: { value: "7d" } });
    expect(screen.getByLabelText<HTMLInputElement>(/since date/i).value).not.toBe("");
    expect(screen.getByLabelText<HTMLInputElement>(/since time/i).value).not.toBe("");
    expect(screen.getByLabelText<HTMLInputElement>(/until date/i).value).not.toBe("");
    expect(screen.getByLabelText<HTMLInputElement>(/until time/i).value).not.toBe("");
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
