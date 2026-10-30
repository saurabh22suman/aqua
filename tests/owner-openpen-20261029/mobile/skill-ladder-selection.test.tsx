// @vitest-environment jsdom
//
// Final-gap SYS02/SYS03 — Skills framework + selected detail.
//
// The reference shows framework rows with one contextual editor, not every
// level/skill editor open at once. Selection must keep entered drafts when the
// owner switches context, and the read-only copy must never promise editing.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

vi.mock("@/lib/actions/skill-ladder", () => ({
  updateSkillLevelAction: vi.fn(async () => ({ ok: true, id: "level-1" })),
  updateSkillNodeAction: vi.fn(async () => ({ ok: true, id: "skill-1" })),
}));

import { SkillLadderManager } from "@/components/skill-ladder-manager";
import type { SkillLadderRow } from "@/lib/services/skill-ladder";

afterEach(cleanup);

function ladders(): SkillLadderRow[] {
  return [
    {
      id: "ladder-1",
      activityTypeKey: "swimming",
      name: "Swimming skill ladder",
      nodes: [
        { id: "level-1", parentId: null, name: "Beginner", ordinal: 1, rubric: {} },
        { id: "skill-1", parentId: "level-1", name: "Water confidence", ordinal: 1, rubric: { "1": "Needs help", "2": "Developing", "3": "Secure", "4": "Leads" } },
        { id: "skill-2", parentId: "level-1", name: "Front float", ordinal: 2, rubric: { "1": "", "2": "", "3": "", "4": "" } },
        { id: "level-2", parentId: null, name: "Intermediate", ordinal: 2, rubric: {} },
        { id: "skill-3", parentId: "level-2", name: "Stroke coordination", ordinal: 1, rubric: { "1": "", "2": "", "3": "", "4": "" } },
      ],
    },
  ];
}

function editor(id: string) {
  return screen.getByTestId(id);
}

describe("Skills framework — selected detail", () => {
  it("opens with one selected skill editor and lists every framework row", () => {
    render(<SkillLadderManager ladders={ladders()} canEdit />);
    expect(screen.getByTestId("framework-level-level-1")).toBeTruthy();
    expect(screen.getByTestId("framework-level-level-2")).toBeTruthy();
    expect(screen.getByTestId("framework-skill-skill-1")).toBeTruthy();
    expect(screen.getByTestId("framework-skill-skill-3")).toBeTruthy();
    // Initial selection is the first skill, like the reference detail.
    expect(editor("skill-editor-skill-1").hasAttribute("hidden")).toBe(false);
    expect(editor("skill-editor-skill-2").hasAttribute("hidden")).toBe(true);
    expect(editor("level-editor-level-1").hasAttribute("hidden")).toBe(true);
  });

  it("switches the single visible editor when a level or skill is selected", () => {
    render(<SkillLadderManager ladders={ladders()} canEdit />);
    expect(
      screen.getByRole("region", { name: "Selected framework detail" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByTestId("framework-level-level-2"));
    expect(
      screen.getByRole("region", { name: "Selected framework detail" }),
    ).toBeTruthy();
    expect(editor("level-editor-level-2").hasAttribute("hidden")).toBe(false);
    expect(editor("skill-editor-skill-1").hasAttribute("hidden")).toBe(true);
    expect(editor("skill-editor-skill-3").hasAttribute("hidden")).toBe(true);

    fireEvent.click(screen.getByTestId("framework-skill-skill-3"));
    expect(editor("skill-editor-skill-3").hasAttribute("hidden")).toBe(false);
    expect(editor("level-editor-level-2").hasAttribute("hidden")).toBe(true);
    // Only one Save control is available in the visible editor.
    const visibleEditors = ["level-editor-level-1", "level-editor-level-2", "skill-editor-skill-1", "skill-editor-skill-2", "skill-editor-skill-3"]
      .map((id) => screen.getByTestId(id))
      .filter((node) => !node.hasAttribute("hidden"));
    expect(visibleEditors).toHaveLength(1);
    expect(within(visibleEditors[0]!).getAllByRole("button", { name: /Save skill|Save level/ })).toHaveLength(1);
  });

  it("keeps entered drafts while switching context", () => {
    render(<SkillLadderManager ladders={ladders()} canEdit />);
    const first = screen.getByTestId("skill-name-skill-1") as HTMLInputElement;
    fireEvent.change(first, { target: { value: "Draft water confidence" } });
    fireEvent.click(screen.getByTestId("framework-skill-skill-2"));
    const second = screen.getByTestId("skill-name-skill-2") as HTMLInputElement;
    fireEvent.change(second, { target: { value: "Draft front float" } });
    fireEvent.click(screen.getByTestId("framework-skill-skill-1"));
    expect((screen.getByTestId("skill-name-skill-1") as HTMLInputElement).value).toBe(
      "Draft water confidence",
    );
    fireEvent.click(screen.getByTestId("framework-skill-skill-2"));
    expect((screen.getByTestId("skill-name-skill-2") as HTMLInputElement).value).toBe(
      "Draft front float",
    );
  });
});

describe("Skills framework — read-only", () => {
  it("does not render save controls or editable copy when canEdit is false", () => {
    render(<SkillLadderManager ladders={ladders()} canEdit={false} />);
    expect(screen.queryByRole("button", { name: /Save (skill|level)/ })).toBeNull();
    expect((screen.getByTestId("skill-name-skill-1") as HTMLInputElement).readOnly).toBe(true);
    expect(screen.getByText(/read-only/i)).toBeTruthy();
  });

  it("does not promise editability in an empty read-only state", () => {
    render(<SkillLadderManager ladders={[]} canEdit={false} />);
    expect(document.body.textContent).toContain(
      "Ask a curriculum lead to apply the swimming preset or add levels; the ladder will appear here. A curriculum lead can add or edit levels.",
    );
    expect(document.body.textContent?.toLowerCase()).not.toContain("editable");
  });
});
