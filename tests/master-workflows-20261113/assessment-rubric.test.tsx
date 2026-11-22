// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { MemberProgress } from "@/lib/services/skill-progress";

const record = vi.fn();
vi.mock("@/lib/actions/assessments", () => ({ recordAssessmentAction: (...args: unknown[]) => record(...args) }));
import { AssessmentBoard } from "@/components/assessment-board";

const node = (id: string, parentId: string | null, name: string, rubric: Record<string, string>) => ({
  id, parentId, name, rubric, ordinal: 1, band: null, assessedAt: null, assessedByName: null, history: [],
});
const progress: MemberProgress = { memberId: "m", memberName: "Learner", memberCode: "M1", frameworks: [{
  id: "f", name: "Framework", activityTypeKey: "swim", nodes: [
    node("l1", null, "Level one", {}), node("s1", "l1", "Float", {"1":"First criterion", "2":"Second criterion", "3":"Third criterion", "4":"Fourth criterion"}),
    node("l2", null, "Level two", {}), node("s2", "l2", "Float", {"1":"Different criterion"}),
  ],
}] };
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it("offers each skill's four criteria before an assessment is recorded", () => {
  render(<AssessmentBoard memberId="m" progress={progress} canAssess back={{href:"/coach",label:"Back"}} />);
  const disclosures = screen.getAllByText("View band criteria");
  expect(disclosures).toHaveLength(2);
  fireEvent.click(disclosures[0]);
  const group = disclosures[0].closest("li")!;
  expect(within(group).getByText("Band 1: First criterion")).toBeTruthy();
  expect(within(group).getByText("Band 2: Second criterion")).toBeTruthy();
  expect(within(group).getByText("Band 3: Third criterion")).toBeTruthy();
  expect(within(group).getByText("Band 4: Fourth criterion")).toBeTruthy();
  expect(record).not.toHaveBeenCalled();
});

it("offers coaches a visible route to the read-only curriculum", () => {
  render(<AssessmentBoard memberId="m" progress={progress} canAssess={false} back={{href:"/coach",label:"Back"}} />);
  expect(screen.getByRole("link", { name: /view curriculum/i }).getAttribute("href")).toBe("/coach/curriculum");
  expect(record).not.toHaveBeenCalled();
});
