// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// V-11 — progress pips and the member progress panel. Pips: four
// states plus "not assessed". Panel: a real ladder renders the latest
// band per node with the history underneath; no ladder renders the
// honest empty state. The parent surface renders none of this by
// design (owner decision 2026-09-18).

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

import { ProgressPips } from "@/components/progress-pips";
import { MemberProgressPanel } from "@/components/member-detail/member-progress-panel";
import type { MemberProgress } from "@/lib/services/skill-progress";

afterEach(cleanup);

function filledCount(container: HTMLElement): number {
  return container.querySelectorAll('[data-testid^="pip-"][data-filled="true"]')
    .length;
}

const PROGRESS: MemberProgress = {
  memberId: "m1",
  memberName: "Aarav",
  memberCode: "SW-001",
  frameworks: [
    {
      id: "f1",
      name: "Swimming skill ladder",
      activityTypeKey: "swimming",
      nodes: [
        {
          id: "level-1",
          parentId: null,
          name: "Beginner",
          ordinal: 1,
          rubric: {},
          band: null,
          assessedAt: null,
          assessedByName: null,
          history: [],
        },
        {
          id: "skill-1",
          parentId: "level-1",
          name: "Water confidence",
          ordinal: 1,
          rubric: { "4": "Comfortable in the deep end" },
          band: 4,
          assessedAt: "2026-09-12T04:00:00.000Z",
          assessedByName: "Coach Ravi",
          history: [
            {
              id: "a2",
              nodeId: "skill-1",
              nodeName: "Water confidence",
              band: 4,
              assessedAt: "2026-09-12T04:00:00.000Z",
              assessedByName: "Coach Ravi",
              notes: null,
            },
            {
              id: "a1",
              nodeId: "skill-1",
              nodeName: "Water confidence",
              band: 2,
              assessedAt: "2026-09-05T04:00:00.000Z",
              assessedByName: "Coach Ravi",
              notes: null,
            },
          ],
        },
        {
          id: "skill-2",
          parentId: "level-1",
          name: "Freestyle",
          ordinal: 2,
          rubric: {},
          band: null,
          assessedAt: null,
          assessedByName: null,
          history: [],
        },
      ],
    },
  ],
};

describe("ProgressPips (V-11)", () => {
  it("renders zero filled pips for an unassessed node and says so", () => {
    const { container } = render(<ProgressPips band={null} label="Freestyle" />);
    expect(filledCount(container)).toBe(0);
    expect(container.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe(
      "Freestyle: not assessed",
    );
  });

  it.each([
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 4],
  ])("renders band %i as %i filled pips", (band, want) => {
    const { container } = render(
      <ProgressPips band={band} label="Water confidence" />,
    );
    expect(filledCount(container)).toBe(want);
  });

  it("treats band 0 as unassessed (never a negative state)", () => {
    const { container } = render(<ProgressPips band={0} label="Freestyle" />);
    expect(filledCount(container)).toBe(0);
  });
});

describe("MemberProgressPanel (V-11)", () => {
  it("renders the ladder, the latest band and the history over time", () => {
    render(<MemberProgressPanel progress={PROGRESS} />);
    const text = document.body.textContent ?? "";
    expect(text).toContain("Swimming skill ladder");
    expect(text).toContain("Water confidence");
    expect(text).toContain("Not assessed yet");
    expect(text).toContain("Last assessed");
    expect(text).toContain("Coach Ravi");
    expect(text).toMatch(/Before that: 2 ·/);
  });

  it("shows the honest empty state without a ladder or assessments", () => {
    render(
      <MemberProgressPanel
        progress={{ ...PROGRESS, frameworks: [] }}
        emptyAction={{ label: "Set up the ladder", href: "/owner/settings/skills" }}
      />,
    );
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/No skill ladder yet/i);
    expect(text).toContain("Set up the ladder");
  });

  it("renders the empty state for a null progress (member not visible)", () => {
    render(<MemberProgressPanel progress={null} />);
    expect(document.body.textContent).toMatch(/No skill ladder yet/i);
  });
});
