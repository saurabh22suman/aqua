// @vitest-environment jsdom
//
// The shared date/time controls keep their contract (31 Oct 2026,
// tranche 2 — independent review findings).
//
// FINDING 1 — the exact-seconds contract. The Ops activity filter's
// native time control was `step={1}`, so a bound carried SECONDS, and
// the model emitted `HH:mm:ss`. A shared time control that only parses
// `HH:mm` would render a seeded bound blank or silently round the
// instant away. The seconds are therefore kept, in their own small
// shared control, so the bound the operator sees is exactly the instant
// the query carries.
//
// FINDING 2 — the imperative guard. The shared date field keeps the
// last valid parent value while the visible text is partial, so an
// Apply that trusts the state can submit a bound the operator never
// entered — or drop the bound they were typing. Every date and time
// part reports its validity, and the imperative submit refuses while a
// part is incomplete or impossible.
//
// These assertions are about the USER OUTCOME: the seconds survive the
// round trip, noon and midnight are not confused, and an invalid entry
// cannot be submitted.
//
// SUPERSEDED IN PART — human steering, 31 October 2026: the Ops filter
// becomes DATE-ONLY, so the exact-seconds FILTER contract below is
// withdrawn and the revised contract replaces it. The cases are kept
// exactly as recorded (they are the evidence of what was reviewed) and
// are marked where they apply. The DATE validity cases, the platform
// activity filter bar and the enquiry follow-up are NOT withdrawn.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: { href?: unknown; children?: unknown; [k: string]: unknown }) => {
      const { href, children, ...rest } = props;
      return React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children as React.ReactNode,
      );
    },
  };
});

type FollowUpInput = { enquiryId: string; dueAt: string; note?: string };
const addFollowUpAction = vi.fn(async (input: FollowUpInput) => {
  void input;
  return { ok: true };
});
vi.mock("@/lib/actions/enquiries", () => ({
  addFollowUpAction: (input: FollowUpInput) => addFollowUpAction(input),
  bookTrialAction: vi.fn(async () => ({ ok: true })),
  completeFollowUpAction: vi.fn(async () => ({ ok: true })),
  convertEnquiryAction: vi.fn(async () => ({ ok: true })),
  transitionEnquiryStageAction: vi.fn(async () => ({ ok: true })),
}));

import { ActivityFilterBar } from "@/components/activity-filter-bar";
import { OpsActivityFilter } from "@/components/ops/ops-activity-filter";
import { EnquiryDetailView } from "@/components/enquiry-detail-view";
import {
  calendarTrigger,
  dayCell,
} from "@/tests/app-wide-ux-20261031/calendar-probe";

beforeEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { search: "" },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderOps(initial: { since?: string; until?: string } = {}) {
  return render(
    <OpsActivityFilter actions={["tenant.activate"]} tenants={[]} initial={initial} />,
  );
}

/** Every alert on the page, joined — the field's own and the form's. */
function alerts(): string {
  return screen
    .getAllByRole("alert")
    .map((node) => node.textContent ?? "")
    .join(" | ");
}

// REVISED — human steering, 31 October 2026: the Ops filter is DATE-ONLY,
// so it carries no hour, minutes, AM/PM or seconds. The exact-seconds
// FILTER contract below is replaced by the date-only one: the bound is a
// calendar date, and a legacy timestamp is normalised to the IST date it
// names. The DATE validity cases, the platform activity filter bar and
// the enquiry follow-up (a SCHEDULING form, which keeps its time) are NOT
// withdrawn.
describe("the Ops bound carries a calendar date", () => {
  it("shows an inbound bound's IST date", () => {
    renderOps({ since: "2026-10-28T12:00:47+05:30" });
    expect(screen.getByLabelText(/since date/i)).toHaveProperty("value", "28/10/2026");
  });

  it("sends the calendar date, not the instant", () => {
    renderOps({ since: "2026-10-28T12:00:47+05:30" });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(window.location.search).toContain("since=2026-10-28");
    expect(window.location.search).not.toContain("T12%3A00%3A47");
  });

  it("keeps the whole IST day of the chosen date", () => {
    renderOps({ since: "2026-10-28", until: "2026-10-28" });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(window.location.search).toContain("since=2026-10-28");
    expect(window.location.search).toContain("until=2026-10-28");
  });
});

describe("an invalid entry cannot be submitted", () => {
  it("refuses a date that is not a real calendar day in the Ops filter", () => {
    renderOps({ since: "2026-02-30" });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    // Nothing was submitted…
    expect(window.location.search).not.toContain("since=");
    // …and the operator is told why.
    expect(alerts()).toMatch(/real date/i);
  });

  it("refuses a date that is not a real calendar day in the platform activity filter bar", () => {
    render(<ActivityFilterBar actions={["tenant.activate"]} initial={{ since: "2026-02-30" }} />);
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(window.location.search).not.toContain("since=");
    expect(alerts()).toMatch(/real date/i);
  });

  it("keeps an untouched optional bound submittable", () => {
    renderOps();
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    // No bound, no error — a blank optional date is not a mistake.
    expect(screen.queryAllByRole("alert")).toHaveLength(0);
    expect(window.location.search).not.toContain("since=");
  });

  it("keeps the add-follow-up action disabled until a date is chosen", () => {
    render(
      <EnquiryDetailView
        enquiry={
          {
            id: "e1",
            fullName: "Asha Rao",
            phone: "+919000000001",
            source: "walk_in",
            stage: "new",
            memberId: null,
            locationId: null,
            createdAt: new Date("2026-10-28T09:00:00Z"),
            notes: null,
            trialBatchId: null,
            followUps: [],
          } as never
        }
        locations={[]}
        batches={[]}
        terminology={{ overrides: {}, locale: "en" } as never}
      />,
    );
    const group = screen.getByRole("group", { name: /due date and time/i });
    const addFollowUp = screen.getByRole("button", {
      name: /^add follow-up$/i,
    }) as HTMLButtonElement;

    // The time is chosen…
    fireEvent.change(within(group).getByLabelText(/due hour/i), { target: { value: "5" } });
    fireEvent.change(within(group).getByLabelText(/due minutes/i), { target: { value: "30" } });
    fireEvent.change(within(group).getByLabelText(/due am\/pm/i), { target: { value: "PM" } });
    // …but there is no DATE yet, so the action waits.
    expect(addFollowUp.disabled).toBe(true);

    // A date from the shared calendar completes the follow-up.
    const trigger = calendarTrigger(document.body);
    expect(trigger, "the follow-up date field offers no calendar").toBeTruthy();
    fireEvent.click(trigger!);
    const day = dayCell(document.body, 15);
    expect(day, "the calendar has no day 15").toBeTruthy();
    fireEvent.click(day!);
    expect(addFollowUp.disabled).toBe(false);
  });
});
