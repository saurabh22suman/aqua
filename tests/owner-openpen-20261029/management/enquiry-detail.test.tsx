// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner OpenPen management lane (29 October 2026).
//
// An enquiry is a timeline plus ONE next action. The follow-up history
// and the next due action sit together, and only one trial/conversion
// workflow is open at a time — the two forms never expand together.

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: {
      href?: unknown;
      children?: unknown;
      [k: string]: unknown;
    }) => {
      const { href, children, ...rest } = props;
      return React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children as React.ReactNode,
      );
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  notFound: () => {
    throw new Error("notFound");
  },
}));

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    permissions: new Set(["enquiries.read", "enquiries.write"]),
    features: new Set<string>(),
  }),
  requirePagePermission: (value: unknown) => value,
}));

const enquiry = {
  id: "11111111-1111-4111-8111-111111111111",
  fullName: "Meera Nair",
  phone: "+919000000103",
  source: "online",
  stage: "contacted",
  locationId: "loc-1",
  memberId: null,
  notes: null,
  trialBatchId: null,
  followUps: [
    {
      id: "follow-1",
      dueAt: new Date("2026-10-28T04:30:00.000Z"),
      note: "Call to confirm preferred time",
      doneAt: null,
    },
    {
      id: "follow-2",
      dueAt: new Date("2026-10-26T04:30:00.000Z"),
      note: "Initial call completed",
      doneAt: new Date("2026-10-26T05:00:00.000Z"),
    },
  ],
};

vi.mock("@/lib/actions/enquiries", () => ({
  getEnquiryDetailAction: async () => enquiry,
  addFollowUpAction: async () => ({ ok: true }),
  bookTrialAction: async () => ({ ok: true }),
  completeFollowUpAction: async () => ({ ok: true }),
  convertEnquiryAction: async () => ({ ok: true, memberId: "member-1" }),
  transitionEnquiryStageAction: async () => ({ ok: true }),
}));

vi.mock("@/lib/actions/people", () => ({
  listLocationsAction: async () => [{ id: "loc-1", name: "Worli Main" }],
}));
vi.mock("@/lib/actions/programs", () => ({
  listBatchesAction: async () => [
    { id: "batch-1", name: "Junior TTS", programName: "Junior" },
  ],
}));
vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ locale: "en", overrides: {} }),
}));

import EnquiryDetailPage from "@/app/(owner)/owner/enquiries/[enquiryId]/page";

afterEach(cleanup);

describe("owner enquiry detail", () => {
  it("pairs the follow-up timeline with one next action", async () => {
    render(
      await EnquiryDetailPage({
        params: Promise.resolve({ enquiryId: enquiry.id }),
      }),
    );

    expect(
      screen.getByRole("heading", { level: 2, name: "Follow-up timeline" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { level: 2, name: "Next action" }),
    ).toBeTruthy();

    // The due follow-up is visible with its action.
    expect(screen.getByText("Call to confirm preferred time")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Mark done" }),
    ).toBeTruthy();
  });

  it("expands only one workflow at a time", async () => {
    render(
      await EnquiryDetailPage({
        params: Promise.resolve({ enquiryId: enquiry.id }),
      }),
    );

    expect(screen.queryByText("Trial batch")).toBeNull();

    fireEvent.click(screen.getByTestId("show-book-trial"));
    expect(screen.getByText("Trial batch")).toBeTruthy();

    fireEvent.click(screen.getByTestId("show-convert"));
    expect(screen.queryByText("Trial batch")).toBeNull();
  });
});
