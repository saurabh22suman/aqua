// @vitest-environment jsdom
//
// The activity FILTERS — dates only (31 Oct 2026, revision).
//
// The human revision withdraws the Ops filter's hour/minute/AM-PM and
// seconds controls: a FILTER asks for DAYS, not for instants. What
// survives is the filter's whole reason to exist:
//
//   * the range choices are date ranges (any date, today, last 7 days,
//     last 30 days, custom) — there is no rolling "last 24 hours";
//   * the query carries DATES, so the URL says what the operator chose;
//   * an inverted or malformed range is REFUSED, never quietly dropped
//     into an unfiltered read;
//   * the action and the tenant stay in the URL.
//
// The legacy platform activity filter bar is the other filter consumer
// and is held to the same rules.
//
// This is a RED-phase file: it is expected to fail until the filters
// are date-only.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ActivityFilterBar } from "@/components/activity-filter-bar";
import { OpsActivityFilter } from "@/components/ops/ops-activity-filter";
import { addDays, todayInZone } from "@/lib/time/tz";

const TZ = "Asia/Kolkata";
const TENANTS = [
  { id: "t1", name: "Aqua Worli", slug: "aqua-worli" },
  { id: "t2", name: "Blue Wave Academy", slug: "bluewave" },
];

beforeEach(() => {
  // jsdom refuses real navigation; the filters assign
  // window.location.search. Replace it with a spyable stand-in.
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { search: "" },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderOpsFilter(initial: {
  action?: string;
  tenantId?: string;
  since?: string;
  until?: string;
} = {}) {
  return render(
    <OpsActivityFilter
      actions={["tenant.activate", "tenant.suspend"]}
      tenants={TENANTS}
      initial={initial}
    />,
  );
}

function select(name: RegExp): HTMLSelectElement {
  return screen.getByRole("combobox", { name }) as HTMLSelectElement;
}

/** The option of a select whose label matches. */
function option(selectEl: HTMLSelectElement, label: RegExp): HTMLOptionElement {
  const found = within(selectEl)
    .getAllByRole("option")
    .find((o) => label.test(o.textContent ?? ""));
  expect(found, `the control has no "${label}" choice`).toBeTruthy();
  return found as HTMLOptionElement;
}

function params(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

function apply(): void {
  fireEvent.click(screen.getByRole("button", { name: /apply/i }));
}

describe("the Ops activity filter — dates only", () => {
  it("carries no hour, minute, AM/PM or seconds control", () => {
    const { container } = renderOpsFilter();
    expect(container.querySelectorAll('input[type="time"]')).toHaveLength(0);
    for (const label of [
      /since hour/i,
      /since minutes/i,
      /since am\/pm/i,
      /since seconds/i,
      /until hour/i,
      /until minutes/i,
      /until am\/pm/i,
      /until seconds/i,
    ]) {
      expect(
        screen.queryByLabelText(label),
        `the filter still carries ${label}`,
      ).toBeNull();
    }
  });

  it("offers date ranges, never a rolling 24 hours", () => {
    renderOpsFilter();
    const choices = within(select(/range/i))
      .getAllByRole("option")
      .map((o) => (o.textContent ?? "").trim())
      .join(" | ");
    expect(choices, "the range choices are not date ranges").toMatch(/any date/i);
    expect(choices).toMatch(/today/i);
    expect(choices).toMatch(/last 7 days/i);
    expect(choices).toMatch(/last 30 days/i);
    expect(choices).toMatch(/custom/i);
    expect(
      choices,
      "the filter still offers a rolling 24-hour range",
    ).not.toMatch(/24 hours|any time/i);
  });

  it("sends one IST calendar day for the Today range", () => {
    renderOpsFilter();
    const range = select(/range/i);
    fireEvent.change(range, {
      target: { value: option(range, /today/i).value },
    });
    apply();

    const today = todayInZone(TZ);
    expect(params().get("since")).toBe(today);
    expect(params().get("until")).toBe(today);
  });

  it("sends today and the preceding six IST dates for the seven-day range", () => {
    renderOpsFilter();
    const range = select(/range/i);
    fireEvent.change(range, {
      target: { value: option(range, /last 7 days/i).value },
    });
    apply();

    const today = todayInZone(TZ);
    expect(params().get("until")).toBe(today);
    expect(params().get("since")).toBe(addDays(today, -6));
  });

  it("sends a custom range as dates and keeps the action and the tenant", () => {
    renderOpsFilter({
      action: "tenant.activate",
      tenantId: "t1",
      since: "2026-03-01",
      until: "2026-03-16",
    });
    apply();

    const query = params();
    expect(query.get("action")).toBe("tenant.activate");
    expect(query.get("tenantId")).toBe("t1");
    expect(query.get("since")).toBe("2026-03-01");
    expect(query.get("until")).toBe("2026-03-16");
    expect(
      window.location.search,
      "the query still carries an instant instead of a date",
    ).not.toMatch(/T\d{2}%3A/);
  });

  it("normalizes a legacy timestamp link to the IST date it names", () => {
    renderOpsFilter({ since: "2026-03-01T17:30:00+05:30" });
    expect(
      (screen.getByLabelText(/since date/i) as HTMLInputElement).value,
    ).toBe("01/03/2026");
    apply();
    expect(params().get("since")).toBe("2026-03-01");
  });

  it("refuses a start that is after the end", () => {
    renderOpsFilter({ since: "2026-03-16", until: "2026-03-01" });
    apply();
    expect(
      window.location.search,
      "an inverted range was submitted",
    ).toBe("");
    expect(
      screen.getByRole("alert"),
      "an inverted range was accepted without a word",
    ).toBeTruthy();
  });

  it("refuses a malformed date instead of quietly reading everything", () => {
    renderOpsFilter({ since: "2026-02-30" });
    apply();
    expect(
      screen.getByRole("alert"),
      "a malformed date was accepted without a word",
    ).toBeTruthy();
    expect(
      window.location.search,
      "a malformed date fell through to an unfiltered read",
    ).toBe("");
  });
});

describe("the legacy platform activity filter bar — dates only", () => {
  it("carries dates only and keeps the action and the tenant", () => {
    const { container } = render(
      <ActivityFilterBar
        actions={["tenant.activate"]}
        initial={{
          action: "tenant.activate",
          tenantId: "t1",
          since: "2026-03-01",
          until: "2026-03-16",
        }}
      />,
    );
    expect(container.querySelectorAll('input[type="time"]')).toHaveLength(0);
    expect(screen.queryByLabelText(/since hour/i)).toBeNull();

    apply();
    const query = params();
    expect(query.get("action")).toBe("tenant.activate");
    expect(query.get("tenantId")).toBe("t1");
    expect(query.get("since")).toBe("2026-03-01");
    expect(query.get("until")).toBe("2026-03-16");
  });

  it("refuses a start that is after the end", () => {
    render(
      <ActivityFilterBar
        actions={["tenant.activate"]}
        initial={{ since: "2026-03-16", until: "2026-03-01" }}
      />,
    );
    apply();
    expect(
      window.location.search,
      "an inverted range was submitted",
    ).toBe("");
    expect(
      screen.getByRole("alert"),
      "an inverted range was accepted without a word",
    ).toBeTruthy();
  });
});
