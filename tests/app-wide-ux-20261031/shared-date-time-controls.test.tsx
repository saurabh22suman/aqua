// @vitest-environment jsdom
//
// Shared date and time controls (31 Oct 2026, tranche 2).
//
// Three shared consumers still asked the BROWSER for a date or a time
// with a native control:
//
//   * components/activity-filter-bar.tsx  — two native `type="date"`
//   * components/ops/ops-activity-filter.tsx — two native `type="date"`
//     and two native `type="time"`
//   * components/enquiry-detail-view.tsx — one native
//     `type="datetime-local"`
//
// The native controls are wrong here for a measured reason: the Ops
// filter's date control was measured at 105px (1280), 73px (1024) and
// 147px on a phone with the YEAR CUT OFF, and the native date input
// ignores the product's day-first format and renders US mm/dd/yyyy
// segments on this locale.
//
// These assertions are about the USER OUTCOME — no native date/time
// control survives, the shared controls are used instead, and the value
// and submission semantics are UNCHANGED: the same bound still produces
// the same query, and the same wall-clock time still produces the same
// instant.
//
// SUPERSEDED IN PART — human steering, 31 October 2026: the Ops filter
// becomes DATE-ONLY, so its hour/minutes/AM-PM group is withdrawn and
// the revised contract replaces it. The cases are kept exactly as
// recorded and are marked where they apply. The platform activity
// filter bar and the enquiry follow-up are NOT withdrawn.

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

/** No browser-native date/time control may survive in these surfaces. */
function expectNoNativeDateTime(container: HTMLElement) {
  expect(container.querySelectorAll('input[type="date"]')).toHaveLength(0);
  expect(container.querySelectorAll('input[type="time"]')).toHaveLength(0);
  expect(container.querySelectorAll('input[type="datetime-local"]')).toHaveLength(0);
  expect(container.querySelectorAll('input[type="month"]')).toHaveLength(0);
  expect(container.querySelectorAll('input[type="week"]')).toHaveLength(0);
}

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

// SUPERSEDED IN PART — human steering, 31 Oct 2026: the Ops filter is
// DATE-ONLY. Its date field stays and carries the calendar; the shared
// hour/minutes/AM-PM group and the instant it carried are withdrawn and
// are replaced by the coordinator's revised contract. The platform
// activity filter bar and the enquiry follow-up are NOT withdrawn: the
// follow-up is a SCHEDULING form and keeps its time.
describe("the Ops activity filter", () => {
  it("uses the shared controls instead of native ones", () => {
    const { container } = render(
      <OpsActivityFilter actions={["tenant.activate"]} tenants={[]} initial={{}} />,
    );
    expectNoNativeDateTime(container);

    // The date bound is the product's shared, day-first date field.
    const since = screen.getByLabelText(/since date/i);
    expect(since.getAttribute("inputmode")).toBe("numeric");
    expect(since.getAttribute("placeholder")).toBe("dd/mm/yyyy");

    // The filter asks for DAYS: there is no time control at all.
    expect(screen.queryByLabelText(/since hour/i)).toBeNull();
    expect(screen.queryByLabelText(/until hour/i)).toBeNull();
  });

  it("carries the same bound into the same query", () => {
    render(
      <OpsActivityFilter actions={["tenant.activate"]} tenants={[]} initial={{}} />,
    );
    const since = screen.getByLabelText(/since date/i);
    fireEvent.change(since, { target: { value: "28/10/2026" } });

    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    // The same calendar date the native control produced.
    expect(window.location.search).toContain("since=2026-10-28");
  });

  it("shows an inbound bound as the IST date it names", () => {
    render(
      <OpsActivityFilter
        actions={["tenant.activate"]}
        tenants={[]}
        initial={{ since: "2026-10-28T17:30:00+05:30" }}
      />,
    );
    expect(screen.getByLabelText(/since date/i)).toHaveProperty("value", "28/10/2026");
  });
});

describe("the platform activity filter bar", () => {
  it("uses the shared date control and keeps the same bound", () => {
    const { container } = render(<ActivityFilterBar actions={["tenant.activate"]} initial={{}} />);
    expectNoNativeDateTime(container);

    const since = screen.getByLabelText(/since date/i);
    fireEvent.change(since, { target: { value: "28/10/2026" } });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(window.location.search).toContain("since=2026-10-28");
  });
});

describe("the enquiry follow-up", () => {
  const ENQUIRY = {
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
  };

  function renderEnquiry() {
    return render(
      <EnquiryDetailView
        enquiry={ENQUIRY as never}
        locations={[]}
        batches={[]}
        terminology={{ overrides: {}, locale: "en" } as never}
      />,
    );
  }

  it("uses the shared date/time group instead of a native datetime control", () => {
    const { container } = renderEnquiry();
    expectNoNativeDateTime(container);

    // One group, labelled, holding the shared date and time controls.
    const group = screen.getByRole("group", { name: /due date and time/i });
    const date = within(group).getByLabelText(/^due date$/i);
    expect(date.getAttribute("inputmode")).toBe("numeric");
    expect(date.getAttribute("placeholder")).toBe("dd/mm/yyyy");
    expect(within(group).getByLabelText(/due hour/i)).toBeTruthy();
    expect(within(group).getByLabelText(/due minutes/i)).toBeTruthy();
    expect(within(group).getByLabelText(/due am\/pm/i)).toBeTruthy();
  });

  it("submits the same instant the native control produced", async () => {
    renderEnquiry();

    const group = screen.getByRole("group", { name: /due date and time/i });
    fireEvent.change(within(group).getByLabelText(/^due date$/i), {
      target: { value: "28/10/2026" },
    });
    fireEvent.change(within(group).getByLabelText(/due hour/i), { target: { value: "5" } });
    fireEvent.change(within(group).getByLabelText(/due minutes/i), { target: { value: "30" } });
    fireEvent.change(within(group).getByLabelText(/due am\/pm/i), { target: { value: "PM" } });

    fireEvent.click(screen.getByRole("button", { name: /^add follow-up$/i }));
    await vi.waitFor(() => expect(addFollowUpAction).toHaveBeenCalled());
    // 28 Oct 2026, 17:30 IST is 12:00 UTC — the same instant as before.
    expect(addFollowUpAction.mock.calls[0]?.[0]).toMatchObject({
      enquiryId: "e1",
      dueAt: "2026-10-28T12:00:00.000Z",
    });
  });
});
