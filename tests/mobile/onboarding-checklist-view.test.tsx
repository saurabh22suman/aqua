// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

// Phase 4 (mobile UX plan v2) — F27. Completed rows rendered "Done"
// twice (subtitle + pill) and the section heading stayed "What's
// left" even when nothing was. One state per row; one truthful
// heading.

vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: { href?: unknown; children?: unknown }) => {
      const { href, children, ...rest } = props as {
        href?: unknown;
        children?: unknown;
        [k: string]: unknown;
      };
      return React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children as ReactNode,
      );
    },
  };
});

import { OnboardingChecklistView } from "@/components/onboarding-checklist";
import type {
  OnboardingChecklist,
  OnboardingItemKey,
} from "@/lib/services/onboarding-checklist";

function item(key: OnboardingItemKey, complete: boolean) {
  return {
    key,
    title: `Step ${key}`,
    detail: `Why ${key} matters`,
    cta: { label: `Do ${key}`, href: `/owner/${key}` },
    complete,
  };
}

const ALL_DONE: OnboardingChecklist = {
  items: [item("add_members", true), item("create_batch", true), item("assign_coach", true)],
  completedCount: 3,
  totalCount: 3,
};

const PARTIAL: OnboardingChecklist = {
  items: [item("add_members", true), item("create_batch", false), item("assign_coach", false)],
  completedCount: 1,
  totalCount: 3,
};

afterEach(cleanup);

describe("OnboardingChecklistView (F27)", () => {
  it("renders exactly one 'Done' per completed row", () => {
    render(<OnboardingChecklistView data={ALL_DONE} />);
    expect(screen.getAllByText("Done")).toHaveLength(3);
  });

  it("switches the section heading once everything is complete", () => {
    render(<OnboardingChecklistView data={ALL_DONE} />);
    expect(screen.getByText("Completed")).toBeTruthy();
    expect(screen.queryByText("What's left")).toBeNull();
  });

  it("keeps 'What's left' while work remains and shows incomplete details", () => {
    render(<OnboardingChecklistView data={PARTIAL} />);
    expect(screen.getByText("What's left")).toBeTruthy();
    expect(screen.getByText("Why create_batch matters")).toBeTruthy();
    expect(screen.getAllByText("Done")).toHaveLength(1);
  });
});
