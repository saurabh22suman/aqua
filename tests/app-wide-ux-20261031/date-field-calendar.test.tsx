// @vitest-environment jsdom
//
// The shared DateField — the CALENDAR contract (31 Oct 2026, revision).
//
// The human revision supersedes the earlier "Ops time/seconds filter"
// direction for the DATE control: the date field is the product's date
// PICKER, so a date is CHOSEN from an app-styled month calendar, not
// typed as text. What must not change is everything around it:
//
//   * the canonical value stays `yyyy-mm-dd` and the display stays
//     DD/MM/YYYY;
//   * the field's API, labels, ref and validity contract survive;
//   * NATIVE form validation survives — a read-only control is barred
//     from constraint validation, so a blank required date must still
//     make `form.checkValidity()` false.
//
// The calendar popup does not exist yet, so this file discovers it the
// way a user does (see ./calendar-probe.ts) instead of importing a
// module that does not exist. Every assertion is about the OUTCOME
// (a chosen day, an emitted ISO, a refused submission), never about
// one exact markup.
//
// This is a RED-phase file: it is expected to fail until the calendar
// is implemented.

import { useState, type FormEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DateField } from "@/components/ui/DateField";
import { todayInZone } from "@/lib/time/tz";
import {
  calendarTrigger,
  dayCell,
  dayCells,
  focusedDay,
} from "./calendar-probe";

const TZ = "Asia/Kolkata";
/** A date in a month that is NOT the current one, so the default view is visible. */
const SELECTED = "2026-03-15";

afterEach(cleanup);

/** The field's text control (the visible one, if there is more than one). */
function dateInput(): HTMLInputElement {
  const matches = screen.getAllByLabelText("Date of birth") as HTMLInputElement[];
  return matches.find((el) => el.type !== "hidden") ?? matches[0]!;
}

/** The form the field sits in. */
function form(): HTMLFormElement {
  return document.querySelector("form")!;
}

function Harness({
  initial = "",
  required = false,
  disabled = false,
  onValidityChange,
}: {
  initial?: string;
  required?: boolean;
  disabled?: boolean;
  onValidityChange?: (valid: boolean) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <form>
      <DateField
        value={value}
        onChange={setValue}
        required={required}
        disabled={disabled}
        aria-label="Date of birth"
        onValidityChange={onValidityChange}
      />
      <output data-testid="value">{value}</output>
    </form>
  );
}

/** Opens the calendar and returns the control that opened it. */
function openCalendar(): HTMLElement {
  const trigger = calendarTrigger(document.body);
  expect(
    trigger,
    "the date field offers no control that opens a calendar",
  ).toBeTruthy();
  fireEvent.click(trigger!);
  return trigger!;
}

describe("the shared DateField — the date is CHOSEN, not typed", () => {
  it("does not take a typed date: the calendar is the way in", () => {
    const onChange = vi.fn();
    render(
      <DateField
        value=""
        onChange={onChange}
        aria-label="Date of birth"
      />,
    );
    const input = dateInput();
    const readOnly =
      input.readOnly || input.getAttribute("aria-readonly") === "true";
    // A read-only control cannot be typed into; a control that only
    // ignores the keystrokes must not emit either.
    if (!readOnly) {
      fireEvent.change(input, { target: { value: "28/10/2026" } });
    }
    expect(input.value, "a typed date reached the field").toBe("");
    expect(onChange, "the field emitted a typed date").not.toHaveBeenCalled();
  });

  it("never submits the form it sits in", () => {
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <DateField
          value={SELECTED}
          onChange={vi.fn()}
          aria-label="Date of birth"
        />
      </form>,
    );
    openCalendar();

    // EVERY button the calendar draws is a plain button: a calendar
    // interaction must never submit the form the field sits in.
    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>("button"),
    );
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(
        button.getAttribute("type"),
        "a calendar button could submit the enclosing form",
      ).toBe("button");
    }

    fireEvent.click(dayCell(document.body, 16)!);
    expect(onSubmit, "choosing a day submitted the form").not.toHaveBeenCalled();
  });

  it("opens a month of days when the field asks for one", () => {
    render(
      <DateField
        value={SELECTED}
        onChange={vi.fn()}
        aria-label="Date of birth"
      />,
    );
    expect(
      dayCells(document.body),
      "the calendar is already open before it was asked for",
    ).toHaveLength(0);

    openCalendar();

    expect(
      dayCells(document.body).length,
      "the calendar shows no month of days",
    ).toBeGreaterThan(27);
    // The calendar is the product's own, not a browser-native control.
    expect(document.querySelectorAll('input[type="date"]')).toHaveLength(0);
    expect(document.querySelectorAll('input[type="month"]')).toHaveLength(0);
  });

  it("emits the chosen day as the canonical ISO date", () => {
    const onChange = vi.fn();
    render(
      <DateField
        value={SELECTED}
        onChange={onChange}
        aria-label="Date of birth"
      />,
    );
    openCalendar();

    const day = dayCell(document.body, 16);
    expect(day, "the calendar has no day 16").toBeTruthy();
    fireEvent.click(day!);

    expect(onChange).toHaveBeenCalledTimes(1);
    // The calendar opened on the SELECTED date's month (March 2026),
    // not on today's month, and the day it emitted is the day chosen.
    expect(onChange).toHaveBeenCalledWith("2026-03-16");
  });

  it("shows the value it was given, day-first", () => {
    render(
      <DateField
        value={SELECTED}
        onChange={vi.fn()}
        aria-label="Date of birth"
      />,
    );
    expect(dateInput().value).toBe("15/03/2026");
  });

  it("offers a way to reach another month and year", () => {
    render(
      <DateField
        value={SELECTED}
        onChange={vi.fn()}
        aria-label="Date of birth"
      />,
    );
    openCalendar();
    const controls = Array.from(
      document.querySelectorAll<HTMLElement>(
        "button, select, [role='button'], [role='combobox']",
      ),
    );
    const navigable = controls.filter((el) =>
      /month|year|previous|next|back|forward|earlier|later/i.test(
        `${el.getAttribute("aria-label") ?? ""} ${el.textContent ?? ""}`,
      ),
    );
    expect(
      navigable.length,
      "the calendar cannot be moved to another month or year, so a birth date is unreachable",
    ).toBeGreaterThan(0);
  });

  it("offers today as a choice", () => {
    const onChange = vi.fn();
    render(
      <DateField
        value={SELECTED}
        onChange={onChange}
        aria-label="Date of birth"
      />,
    );
    openCalendar();
    const today = Array.from(
      document.querySelectorAll<HTMLElement>("button"),
    ).find((el) =>
      /today/i.test(
        `${el.getAttribute("aria-label") ?? ""} ${el.textContent ?? ""}`,
      ),
    );
    expect(today, "the calendar offers no Today choice").toBeTruthy();
    fireEvent.click(today!);
    expect(onChange).toHaveBeenCalledWith(todayInZone(TZ));
  });

  it("offers a way to clear an optional date", () => {
    const onChange = vi.fn();
    render(
      <DateField
        value={SELECTED}
        onChange={onChange}
        aria-label="Date of birth"
      />,
    );
    openCalendar();
    const clear = Array.from(
      document.querySelectorAll<HTMLElement>("button"),
    ).find((el) =>
      /clear|remove/i.test(
        `${el.getAttribute("aria-label") ?? ""} ${el.textContent ?? ""}`,
      ),
    );
    expect(clear, "the calendar offers no way to clear the chosen date").toBeTruthy();
    fireEvent.click(clear!);
    expect(onChange).toHaveBeenCalledWith("");
  });
});

describe("the shared DateField — keyboard and focus", () => {
  it("moves the chosen day with the arrow keys", () => {
    render(
      <DateField
        value={SELECTED}
        onChange={vi.fn()}
        aria-label="Date of birth"
      />,
    );
    openCalendar();
    const cells = dayCells(document.body);
    expect(cells.length, "the calendar shows no month of days").toBeGreaterThan(27);

    const before = focusedDay();
    fireEvent.keyDown(cells[0]!, { key: "ArrowRight" });
    const after = focusedDay();

    expect(
      after,
      "the arrow key did not move the keyboard inside the calendar",
    ).not.toBe(before);
  });

  it("closes on Escape and gives the focus back to the field", () => {
    render(
      <DateField
        value={SELECTED}
        onChange={vi.fn()}
        aria-label="Date of birth"
      />,
    );
    const trigger = openCalendar();
    expect(dayCells(document.body).length).toBeGreaterThan(0);

    fireEvent.keyDown(dayCells(document.body)[0]!, { key: "Escape" });

    expect(
      dayCells(document.body),
      "the calendar stayed open after Escape",
    ).toHaveLength(0);
    expect(
      [trigger, dateInput()],
      "the focus was not given back to the field",
    ).toContain(document.activeElement);
  });
});

describe("the shared DateField — the states around the calendar", () => {
  it("keeps the native required validation on a blank required date", async () => {
    const onValidityChange = vi.fn();
    render(<Harness required onValidityChange={onValidityChange} />);
    await waitFor(() =>
      expect(onValidityChange).toHaveBeenLastCalledWith(false),
    );
    expect(
      form().checkValidity(),
      "a blank required date is accepted by the form",
    ).toBe(false);
  });

  it("treats a blank optional date as valid", async () => {
    const onValidityChange = vi.fn();
    render(<Harness onValidityChange={onValidityChange} />);
    await waitFor(() =>
      expect(onValidityChange).toHaveBeenLastCalledWith(true),
    );
    expect(form().checkValidity()).toBe(true);
  });

  it("becomes valid once a date is chosen", async () => {
    const onValidityChange = vi.fn();
    render(<Harness required onValidityChange={onValidityChange} />);
    openCalendar();
    fireEvent.click(dayCell(document.body, 16)!);
    await waitFor(() =>
      expect(onValidityChange).toHaveBeenLastCalledWith(true),
    );
    // The chosen day is the field's value. The blank required field
    // opened the calendar on TODAY's month, so the month is whatever
    // the calendar showed — the day is the one that was clicked.
    expect(
      screen.getByTestId("value").textContent,
      "the chosen date was not the field's value",
    ).toMatch(/^\d{4}-\d{2}-16$/);
    expect(form().checkValidity()).toBe(true);
  });

  it("cannot be changed while the field is disabled", () => {
    const onChange = vi.fn();
    render(
      <DateField
        value={SELECTED}
        onChange={onChange}
        disabled
        aria-label="Date of birth"
      />,
    );
    expect(dateInput().disabled).toBe(true);

    const trigger = calendarTrigger(document.body);
    if (trigger) {
      expect(
        (trigger as HTMLButtonElement).disabled,
        "the calendar trigger is live on a disabled field",
      ).toBe(true);
    }
    expect(
      dayCells(document.body),
      "a disabled field opened the calendar",
    ).toHaveLength(0);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("shows the caller's error state", () => {
    render(
      <DateField
        value={SELECTED}
        onChange={vi.fn()}
        aria-label="Date of birth"
        aria-invalid
        aria-describedby="dob-error"
      />,
    );
    const input = dateInput();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(
      (input.getAttribute("aria-describedby") ?? "").split(/\s+/),
    ).toContain("dob-error");
  });
});
