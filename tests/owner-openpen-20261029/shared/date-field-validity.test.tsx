// @vitest-environment jsdom
//
// Shared DateField validity contract (29 Oct 2026; revised 31 Oct 2026).
//
// Optional fully blank is valid; a date that is not a real calendar day
// and a blank required date are invalid. The callback lets an
// imperative submit (the new-subscription consumer) guard its action,
// while native required/custom validity makes a real form refuse the
// same states.
//
// REVISED (human revision, 31 October 2026): the date is CHOSEN from
// the shared calendar, so the text control is READ-ONLY and a person
// cannot type a date into it. Two things moved with that:
//
//   1. The field's native validity now lives on the field's own
//      COMPANION control (a read-only input is barred from constraint
//      validation), so `form.checkValidity()` still refuses a blank
//      required date and an impossible one — the assertions below are
//      unchanged in meaning.
//   2. The cases that typed a PARTIAL or IMPOSSIBLE date into the
//      control now assert the PARSER's contract (the exported
//      `displayToIso`, whose invalid and leap behaviour is part of this
//      component's public surface) and the field's own refusal of a
//      value that is not a real calendar day.

import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DateField, displayToIso, isoToDisplay } from "@/components/ui/DateField";
import {
  calendarTrigger,
  dayCell,
} from "@/tests/app-wide-ux-20261031/calendar-probe";

afterEach(cleanup);

function DateHarness({
  initial = "",
  required = false,
  onValidityChange,
  onAction,
}: {
  initial?: string;
  required?: boolean;
  onValidityChange?: (valid: boolean) => void;
  onAction?: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [valid, setValid] = useState(true);

  return (
    <form>
      <DateField
        id="subscription-start"
        value={value}
        onChange={setValue}
        required={required}
        aria-label="Subscription starts on"
        onValidityChange={(next) => {
          setValid(next);
          onValidityChange?.(next);
        }}
      />
      <input type="hidden" data-testid="date-value" value={value} readOnly />
      <button type="button" disabled={!valid} onClick={() => onAction?.()}>
        Start subscription
      </button>
      <button
        type="button"
        onClick={() => {
          setValue("");
        }}
      >
        Reset
      </button>
    </form>
  );
}

function field() {
  return screen.getByLabelText("Subscription starts on") as HTMLInputElement;
}

function formOf(input: HTMLInputElement) {
  return input.form!;
}

function emitted() {
  return (screen.getByTestId("date-value") as HTMLInputElement).value;
}

/** Opens the field's calendar and chooses the given day of the month. */
function chooseDay(day: number) {
  const trigger = calendarTrigger(document.body);
  expect(trigger, "the field offers no calendar").toBeTruthy();
  fireEvent.click(trigger!);
  const cell = dayCell(document.body, day);
  expect(cell, `the calendar has no day ${day}`).toBeTruthy();
  fireEvent.click(cell!);
}

describe("DateField — optional and required validity", () => {
  it("treats a fully blank optional date as valid", async () => {
    const onValidityChange = vi.fn();
    render(<DateHarness onValidityChange={onValidityChange} />);
    await waitFor(() => expect(onValidityChange).toHaveBeenLastCalledWith(true));
    expect(field().value).toBe("");
    expect(formOf(field()).checkValidity()).toBe(true);
  });

  it("treats a required blank date as invalid", async () => {
    const onValidityChange = vi.fn();
    render(<DateHarness required onValidityChange={onValidityChange} />);
    await waitFor(() => expect(onValidityChange).toHaveBeenLastCalledWith(false));
    expect(
      (screen.getByRole("button", { name: "Start subscription" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(formOf(field()).checkValidity()).toBe(false);
    expect(field().required).toBe(true);
  });

  it("treats a date that is not a real calendar day as invalid", async () => {
    const onValidityChange = vi.fn();
    // A value that arrives from outside the calendar — a legacy row,
    // a hand-edited link — that is not a day the calendar has.
    render(
      <DateField
        value="2026-02-31"
        onChange={() => {}}
        aria-label="Subscription starts on"
        onValidityChange={onValidityChange}
      />,
    );
    await waitFor(() => expect(onValidityChange).toHaveBeenLastCalledWith(false));
    expect(field().getAttribute("aria-invalid")).toBe("true");
    // The field says what is wrong, in its own words.
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toMatch(/date/i);
  });

  it("reports a valid chosen date and emits its ISO value", async () => {
    const onValidityChange = vi.fn();
    render(<DateHarness onValidityChange={onValidityChange} />);
    chooseDay(16);
    await waitFor(() => expect(onValidityChange).toHaveBeenLastCalledWith(true));
    expect(emitted()).toMatch(/^\d{4}-\d{2}-16$/);
    expect(
      (screen.getByRole("button", { name: "Start subscription" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(formOf(field()).checkValidity()).toBe(true);
  });
});

describe("DateField — the parser behind the calendar", () => {
  it("refuses partial and impossible days and accepts a leap day", () => {
    expect(displayToIso("12/1")).toBeNull();
    expect(displayToIso("31/02/2026")).toBeNull();
    expect(displayToIso("29/02/2025")).toBeNull();
    expect(displayToIso("29/02/2024")).toBe("2024-02-29");
    expect(displayToIso("31/12/1899")).toBeNull();
  });

  it("shows the canonical day-first display", () => {
    expect(isoToDisplay("2024-02-29")).toBe("29/02/2024");
    expect(isoToDisplay("")).toBe("");
    expect(isoToDisplay(null)).toBe("");
  });
});

describe("DateField — imperative guard and parent reset", () => {
  it("permits the imperative action for a deliberately blank or valid date", async () => {
    const onAction = vi.fn();
    render(<DateHarness onAction={onAction} />);
    expect(
      (screen.getByRole("button", { name: "Start subscription" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Start subscription" }));
    expect(onAction).toHaveBeenCalledTimes(1);

    chooseDay(16);
    fireEvent.click(screen.getByRole("button", { name: "Start subscription" }));
    expect(onAction).toHaveBeenCalledTimes(2);
  });

  it("clears a complete valid date on parent reset and reports valid blank", async () => {
    const onValidityChange = vi.fn();
    render(<DateHarness initial="2024-02-29" onValidityChange={onValidityChange} />);
    expect(field().value).toBe("29/02/2024");
    await waitFor(() => expect(onValidityChange).toHaveBeenLastCalledWith(true));
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(field().value).toBe("");
    await waitFor(() => expect(onValidityChange).toHaveBeenLastCalledWith(true));
    expect(formOf(field()).checkValidity()).toBe(true);
  });

  it("clears the error when a real date replaces an impossible one", async () => {
    const { rerender } = render(
      <DateField
        value="2026-02-31"
        onChange={() => {}}
        aria-label="Subscription starts on"
      />,
    );
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert")).toBeTruthy();

    rerender(
      <DateField
        value="2026-03-01"
        onChange={() => {}}
        aria-label="Subscription starts on"
      />,
    );
    expect(field().getAttribute("aria-invalid")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
