// @vitest-environment jsdom
//
// Mobile slice (29 Oct 2026) — DateField / Field accessibility integration.
//
// Current DateField shows a placeholder but no persistent format guidance,
// and its internal invalid message has no id/role, so a screen-reader user
// does not get the DD/MM/YYYY rule or the referenced validation text. Field
// already supplies description/error ids through its render prop; DateField
// must accept and merge them without breaking its day-first ISO contract.
//
// REVISED (31 October 2026): the date is CHOSEN from the shared calendar,
// so the text control is read-only and the format guidance is
// screen-reader-only by default. The guidance is still PRESENT and still
// referenced from the input — that is what this file pins. The cases that
// typed a date into the control now choose the date from the calendar (the
// month and the year are named directly, so a birth date is reachable) and
// assert the shared parser for the values a person cannot type.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DateField, displayToIso } from "@/components/ui/DateField";
import { Field } from "@/components/ui/Field";
import {
  calendarTrigger,
  dayCell,
} from "@/tests/app-wide-ux-20261031/calendar-probe";

afterEach(cleanup);

function renderDateField(
  props: Record<string, unknown> = {},
  initial = "",
) {
  render(
    <DateField
      value={initial}
      onChange={() => {}}
      aria-label="Date of birth"
      {...(props as object)}
    />,
  );
  return screen.getByLabelText("Date of birth") as HTMLInputElement;
}

describe("DateField — persistent format guidance", () => {
  it("shows a persistent DD/MM/YYYY hint and references it from the input", () => {
    const input = renderDateField();
    expect(screen.getByText(/DD\/MM\/YYYY/)).toBeTruthy();
    expect(input.getAttribute("aria-describedby")).toBeTruthy();
    const describedBy = (input.getAttribute("aria-describedby") ?? "").split(/\s+/);
    const hint = screen.getByText(/DD\/MM\/YYYY/);
    expect(describedBy).toContain(hint.id);
  });

  it("does not only carry the format in the placeholder", () => {
    const input = renderDateField();
    // The date is chosen from the calendar, so the guidance is kept for
    // a screen reader rather than shown as a paragraph — but it is there.
    expect(input.getAttribute("placeholder")).toBeTruthy();
    expect(screen.getByText(/DD\/MM\/YYYY/)).toBeTruthy();
  });

  it("does not let a person type a date into the control", () => {
    const input = renderDateField();
    expect(input.readOnly).toBe(true);
  });
});

describe("DateField — Field integration", () => {
  it("merges the Field description/error ids, required and invalid state", () => {
    render(
      <Field
        id="dob-field"
        label="Date of birth"
        description="Use the date on the birth certificate."
        error="Enter a real date."
        required
      >
        {(field) => (
          <DateField
            {...(field as unknown as Record<string, unknown>)}
            value=""
            onChange={() => {}}
            aria-label="Date of birth"
          />
        )}
      </Field>,
    );
    const input = screen.getByLabelText("Date of birth") as HTMLInputElement;
    const describedBy = (input.getAttribute("aria-describedby") ?? "").split(/\s+/);
    expect(describedBy).toContain("dob-field-description");
    expect(describedBy).toContain("dob-field-error");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-required")).toBe("true");
    expect(input.required).toBe(true);
  });

  it("keeps a stable id and its own described-by chain", () => {
    const input = renderDateField({ id: "member-dob" });
    expect(input.id).toBe("member-dob");
    expect(input.getAttribute("aria-describedby")).toContain("member-dob-format");
  });
});

describe("DateField — the day is chosen from the calendar", () => {
  it("emits the ISO of a leap day reached through the month and year", () => {
    const seen: string[] = [];
    render(
      <DateField
        value=""
        onChange={(iso) => seen.push(iso)}
        aria-label="Leap date"
      />,
    );
    const trigger = calendarTrigger(document.body);
    expect(trigger, "the field offers no calendar").toBeTruthy();
    fireEvent.click(trigger!);

    // The year and the month are NAMED, so a birth date is reachable
    // without walking back month by month.
    fireEvent.change(screen.getByLabelText("Year"), { target: { value: "2024" } });
    fireEvent.change(screen.getByLabelText("Month"), { target: { value: "2" } });

    const day = dayCell(document.body, 29);
    expect(day, "February 2024 has no day 29").toBeTruthy();
    fireEvent.click(day!);

    expect(seen.at(-1)).toBe("2024-02-29");
    expect(screen.getByLabelText("Leap date").getAttribute("aria-invalid")).toBeNull();
  });

  it("refuses a day that does not exist, through the shared parser", () => {
    // 29 February only exists in a leap year; a year before 1900 is not
    // a date the product accepts.
    expect(displayToIso("29/02/2025")).toBeNull();
    expect(displayToIso("29/02/2024")).toBe("2024-02-29");
    expect(displayToIso("31/12/1899")).toBeNull();
  });
});
