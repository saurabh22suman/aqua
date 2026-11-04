// @vitest-environment jsdom
//
// The member inline date editor — the CALENDAR contract (31 Oct 2026).
//
// The revision makes the shared DateField a calendar. The inline editor
// is the consumer that breaks first when a control grows a popup: the
// editor saves on blur, so MOVING THE FOCUS INTO THE CALENDAR would
// save the old value, or close the editor under the operator's finger.
//
// The contract:
//
//   * opening the calendar writes nothing and closes nothing;
//   * choosing a day commits EXACTLY that ISO, exactly once — never the
//     previous value, never twice;
//   * Escape writes nothing.
//
// The calendar popup does not exist yet, so this file discovers it the
// way a user does (see ./calendar-probe.ts) rather than importing a
// module that does not exist.
//
// This is a RED-phase file: it is expected to fail until the calendar
// is implemented.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { calendarTrigger, dayCell, dayCells } from "./calendar-probe";

const { updateMemberAction } = vi.hoisted(() => ({
  // The real action echoes the value it persisted.
  updateMemberAction: vi.fn(
    async (input: { memberId: string; dateOfBirth: string }) => ({
      ok: true as const,
      value: { dateOfBirth: input.dateOfBirth },
    }),
  ),
}));

vi.mock("@/lib/actions/people", () => ({
  updateMemberAction: (input: { memberId: string; dateOfBirth: string }) =>
    updateMemberAction(input),
}));

import { InlineEditField } from "@/components/member-detail/inline-edit-field";

const MEMBER = "member-1";
const STORED = "2015-12-31";

afterEach(() => {
  cleanup();
  updateMemberAction.mockClear();
});

/** Opens the inline editor and returns its text control. */
function enterEdit(): HTMLInputElement {
  fireEvent.click(screen.getByRole("button", { name: /edit date of birth/i }));
  return screen.getByLabelText("date of birth") as HTMLInputElement;
}

function renderEditor() {
  return render(
    <InlineEditField
      field="dateOfBirth"
      memberId={MEMBER}
      type="date"
      value={STORED}
    />,
  );
}

describe("the member inline date editor — the calendar", () => {
  it("opens the calendar without saving or cancelling the edit", () => {
    renderEditor();
    const input = enterEdit();

    const trigger = calendarTrigger(document.body);
    expect(
      trigger,
      "the inline date editor offers no calendar",
    ).toBeTruthy();
    fireEvent.click(trigger!);

    // The operator's focus moved from the field into the calendar.
    fireEvent.blur(input);

    expect(
      updateMemberAction,
      "opening the calendar wrote a value",
    ).not.toHaveBeenCalled();
    expect(
      screen.getByLabelText("date of birth"),
      "the editor closed when the focus moved into the calendar",
    ).toBeTruthy();
  });

  it("commits the chosen date exactly once, and never the previous value", async () => {
    renderEditor();
    enterEdit();

    const trigger = calendarTrigger(document.body);
    expect(trigger, "the inline date editor offers no calendar").toBeTruthy();
    fireEvent.click(trigger!);

    const day = dayCell(document.body, 16);
    expect(day, "the calendar has no day 16").toBeTruthy();
    fireEvent.click(day!);

    await waitFor(() =>
      expect(updateMemberAction).toHaveBeenCalledTimes(1),
    );
    expect(updateMemberAction).toHaveBeenCalledWith({
      memberId: MEMBER,
      dateOfBirth: "2015-12-16",
    });
  });

  it("writes nothing when the calendar is dismissed with Escape", () => {
    renderEditor();
    enterEdit();

    const trigger = calendarTrigger(document.body);
    expect(trigger, "the inline date editor offers no calendar").toBeTruthy();
    fireEvent.click(trigger!);
    expect(dayCells(document.body).length).toBeGreaterThan(0);

    fireEvent.keyDown(dayCells(document.body)[0]!, { key: "Escape" });

    expect(
      updateMemberAction,
      "dismissing the calendar wrote a value",
    ).not.toHaveBeenCalled();
  });

  it("still shows the stored date while it is not being edited", () => {
    renderEditor();
    expect(screen.getByText(/2015/).textContent).toContain("2015");
  });
});
