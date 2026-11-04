// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/membership-plans", () => ({}));
vi.mock("@/lib/actions/activities", () => ({}));
vi.mock("@/lib/actions/holidays", () => ({}));
vi.mock("@/lib/actions/skill-ladder", () => ({}));

import { PlanManager } from "@/components/plan-manager";
import { ActivityManager } from "@/components/activity-manager";
import { HolidaysBoard } from "@/components/holidays-board";
import { SkillLadderManager } from "@/components/skill-ladder-manager";

afterEach(cleanup);

describe("owner settings disclosures", () => {
  it.each([
    ["Add plan", <PlanManager key="plan" templates={[]} plans={[]} locations={[]} activities={[]} />],
    ["Use a preset template", <PlanManager key="plan" templates={[]} plans={[]} locations={[]} activities={[]} />],
    ["Add activity", <ActivityManager key="activity" locations={[]} activities={[]} />],
    ["Add holiday", <HolidaysBoard key="holiday" initialHolidays={[]} />],
  ])("shows a decorative disclosure indicator for %s", (label, component) => {
    const { container } = render(component);
    const summary = Array.from(container.querySelectorAll("summary")).find((node) => node.textContent?.trim() === label);
    expect(summary).toBeDefined();
    expect(summary?.closest("details")?.open).toBe(false);
    expect(summary?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });
  it("tells the owner the real next step when no skill ladder exists", () => {
    render(<SkillLadderManager ladders={[]} canEdit />);
    expect(screen.getByText("Ask your platform operator to apply a skill preset.")).toBeTruthy();
  });
});
