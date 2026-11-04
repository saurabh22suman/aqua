// @vitest-environment jsdom
//
// The shared DateField — the REVIEW findings (31 October 2026).
//
// The calendar exists and the initial RED is closed; this file is the
// review round. It pins the behaviour the reviewer found missing, in
// the four places the reviewer found it:
//
//   1. OPENING. The date DISPLAY is the control: clicking it opens the
//      calendar, and Enter / Space / Alt+ArrowDown open it BEFORE an
//      enclosing inline editor can commit the old value on Enter.
//   2. VALIDITY. The field's companion control must honour `disabled`:
//      a disabled required date must not block the form. A blank
//      required date is invalid (the native refusal still holds) but
//      shows no visible alert before an attempt. The read-only control
//      itself is barred from constraint validation, so the companion
//      control is what refuses.
//   3. OWNED POPUPS. The calendar's own month/year listbox is part of
//      the calendar: a press on it must not unmount the picker, while a
//      press on an UNRELATED listbox must still dismiss it.
//   4. FIT. The header must be able to reflow and its buttons must be
//      reachable; the popup must be sized to the CLIENT viewport, not
//      to the window, must follow the viewport when it changes, and must
//      not be cut off by a short viewport.
//   5. KEYS AND FOCUS. The calendar must not take the header select's
//      arrow/page/home keys, and leaving the whole field (with the
//      calendar and any nested popup) must tell the consumer the edit
//      ended instead of suppressing the blur for ever.
//
// The calendar's own dates are asserted too: it must never offer or
// emit a day outside the range the product accepts, and the day arrows
// must carry the DISPLAYED month across a month or year boundary.
//
// The assertions are about OUTCOMES (a calendar opened, a value
// committed, a refusal, a visible layout intent), so any reasonable
// implementation of the same contract passes. The layout assertions
// are LAYOUT INTENT, not a measurement: the real text fit and geometry
// at 320/360/390 and 1280 are measured in Chrome by the coordinator.

import { useState, type KeyboardEvent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { DateField } from "@/components/ui/DateField";
import { DateCalendarHeader } from "@/components/ui/DateCalendarHeader";
import { parseCalendarDate } from "@/lib/time/calendar";
import { calendarTrigger, dayCell, dayCells } from "./calendar-probe";

/** A date in a month that is NOT the current one, so the default view is visible. */
const SELECTED = "2026-03-15";
/** The first year the product's calendar accepts. */
const EARLIEST = "1900";
/**
 * The client viewport the popup must fit into. It is deliberately
 * NARROWER than the window: a classic scrollbar takes the difference,
 * and a popup sized to the window runs under the scrollbar.
 */
const CLIENT_WIDTH = 300;
const CLIENT_HEIGHT = 300;

beforeEach(() => {
  Object.defineProperty(document.documentElement, "clientWidth", {
    configurable: true,
    value: CLIENT_WIDTH,
  });
  Object.defineProperty(document.documentElement, "clientHeight", {
    configurable: true,
    value: CLIENT_HEIGHT,
  });
});

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

/** The popup the calendar draws, wherever it is drawn. */
function calendarPopup(): HTMLElement | null {
  return document.querySelector<HTMLElement>(
    '[role="dialog"], [data-date-calendar]',
  );
}

/** The day the grid's roving tabindex is on. */
function rovingDay(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[role="grid"] button[tabindex="0"]');
}

/** The day the keyboard is on: the focused day, or the roving target. */
function currentDay(): HTMLElement {
  const active = document.activeElement as HTMLElement | null;
  if (active && active.tagName === "BUTTON" && active.closest('[role="grid"]')) {
    return active;
  }
  const roving = rovingDay();
  expect(roving, "the calendar lost its focused day").toBeTruthy();
  return roving!;
}

/** The months the calendar is showing, in the order they were drawn. */
function shownMonths(): string[] {
  return Array.from(document.querySelectorAll('[role="grid"]')).map(
    (grid) => grid.getAttribute("aria-label") ?? "",
  );
}

/** The height a popup declares it cannot exceed, as a number. */
function numericMaxHeight(element: HTMLElement): number | null {
  const inline = Number.parseFloat(element.style.maxHeight);
  if (Number.isFinite(inline)) return inline;
  const declared = /max-h-\[([0-9.]+)px\]/.exec(
    element.getAttribute("class") ?? "",
  );
  return declared ? Number(declared[1]) : null;
}

/** Whether the popup's content can be scrolled to. */
function hasScrollableOverflow(element: HTMLElement): boolean {
  const scrollable = /overflow-y-(?:auto|scroll)|overflow-(?:auto|scroll)/;
  const nodes = [element, ...Array.from(element.querySelectorAll<HTMLElement>("*"))];
  return nodes.some(
    (node) =>
      scrollable.test(node.getAttribute("class") ?? "") ||
      /auto|scroll/.test(node.style.overflowY),
  );
}

/**
 * The share of its row a track declares for itself: how much it grows
 * relative to its neighbours, times the width it starts from.
 */
function trackShare(track: HTMLElement): number {
  const classes = track.getAttribute("class") ?? "";
  const grow = /(?:^|\s)(?:flex-(\d+)|flex-\[(\d+(?:\.\d+)?)\]|grow-(\d+))(?:\s|$)/.exec(
    classes,
  );
  const factor = grow ? Number(grow[1] ?? grow[2] ?? grow[3]) : 1;
  const basis = /basis-\[([0-9.]+)px\]/.exec(classes);
  return factor * (basis ? Number(basis[1]) : 1);
}

/** The track a selector sits in: the nearest ancestor that claims a share. */
function trackOf(control: HTMLElement): HTMLElement {
  let node = control.parentElement;
  while (node) {
    const classes = node.getAttribute("class") ?? "";
    if (/(?:^|\s)(?:flex-\[|flex-\d|grow-\d)/.test(classes)) return node;
    node = node.parentElement;
  }
  throw new Error("the selector has no track of its own");
}

/** Opens the calendar through its own trigger. */
function openCalendar(): HTMLElement {
  const trigger = calendarTrigger(document.body);
  expect(trigger, "the date field offers no control that opens a calendar").toBeTruthy();
  fireEvent.click(trigger!);
  return trigger!;
}

/** A field in a form, with a control outside it to move the focus to. */
function Harness({
  initial = "",
  required = false,
  disabled = false,
  onValidityChange,
  onBlur,
}: {
  initial?: string;
  required?: boolean;
  disabled?: boolean;
  onValidityChange?: (valid: boolean) => void;
  onBlur?: () => void;
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
        onBlur={onBlur}
      />
      <output data-testid="value">{value}</output>
      <button type="button" data-testid="outside">
        Outside
      </button>
    </form>
  );
}

/**
 * An enclosing inline editor, as the member detail really is: Enter
 * commits the draft the editor holds. The calendar must open BEFORE
 * that commit, so the old value is never written.
 */
function InlineHarness({ onCommit }: { onCommit: (value: string) => void }) {
  const [value, setValue] = useState(SELECTED);
  return (
    <DateField
      value={value}
      onChange={(iso) => {
        setValue(iso);
        onCommit(iso);
      }}
      onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") {
          event.preventDefault();
          onCommit(value);
        }
      }}
      aria-label="Date of birth"
    />
  );
}

describe("the shared DateField — opening the calendar", () => {
  it("opens the calendar when the date display is clicked", () => {
    render(
      <DateField value={SELECTED} onChange={vi.fn()} aria-label="Date of birth" />,
    );
    expect(dayCells(document.body)).toHaveLength(0);

    fireEvent.click(dateInput());

    expect(
      dayCells(document.body).length,
      "clicking the date display did not open the calendar",
    ).toBeGreaterThan(27);
  });

  it("opens the calendar on Enter before an enclosing editor can commit the old value", () => {
    const onCommit = vi.fn();
    render(<InlineHarness onCommit={onCommit} />);

    fireEvent.keyDown(dateInput(), { key: "Enter" });

    expect(
      dayCells(document.body).length,
      "Enter did not open the calendar, so the reader cannot choose a date",
    ).toBeGreaterThan(27);
    expect(
      onCommit,
      "the enclosing editor committed the old value instead of opening the calendar",
    ).not.toHaveBeenCalled();
  });

  it("opens the calendar on Space and on Alt+ArrowDown as well", () => {
    render(
      <DateField value={SELECTED} onChange={vi.fn()} aria-label="Date of birth" />,
    );

    fireEvent.keyDown(dateInput(), { key: " " });
    expect(
      dayCells(document.body).length,
      "Space did not open the calendar",
    ).toBeGreaterThan(27);

    fireEvent.keyDown(dayCells(document.body)[0]!, { key: "Escape" });
    expect(dayCells(document.body)).toHaveLength(0);

    fireEvent.keyDown(dateInput(), { key: "ArrowDown", altKey: true });
    expect(
      dayCells(document.body).length,
      "Alt+ArrowDown did not open the calendar",
    ).toBeGreaterThan(27);
  });
});

describe("the shared DateField — the validity of a disabled or blank date", () => {
  it("does not let a disabled required date block the form", () => {
    render(<Harness required disabled />);

    expect(
      form().checkValidity(),
      "a disabled required date blocks a form it is not even part of",
    ).toBe(true);
  });

  it("keeps a blank required date invalid without a premature visible error", async () => {
    const onValidityChange = vi.fn();
    render(<Harness required onValidityChange={onValidityChange} />);

    await waitFor(() =>
      expect(onValidityChange).toHaveBeenLastCalledWith(false),
    );
    // The untouched UI is QUIET: nothing has been attempted yet, so the
    // field does not announce an error the operator has not made. The
    // native refusal is checked AFTER this, because checkValidity()
    // dispatches `invalid` too.
    expect(
      screen.queryByRole("alert"),
      "a blank required date announced an error before anything was attempted",
    ).toBeNull();
    expect(
      form().checkValidity(),
      "a blank required date is accepted by the form",
    ).toBe(false);
  });

  it("says what is wrong when a real attempt is refused", async () => {
    render(<Harness required />);

    await act(async () => {
      form().requestSubmit();
    });

    const alert = screen.getByRole("alert");
    expect(alert.textContent, "the refusal says nothing about the date").toMatch(/date/i);
    expect(
      document.activeElement,
      "the refused field did not take the focus",
    ).toBe(dateInput());
  });

  it("keeps an optional blank date valid and the read-only control unvalidatable", async () => {
    const onValidityChange = vi.fn();
    render(<Harness onValidityChange={onValidityChange} />);

    await waitFor(() =>
      expect(onValidityChange).toHaveBeenLastCalledWith(true),
    );
    expect(form().checkValidity()).toBe(true);
    // The visible control is read-only, so it is barred from constraint
    // validation: the field's own companion control is what refuses.
    expect(
      dateInput().willValidate,
      "the read-only control is being validated as if a person could type in it",
    ).toBe(false);
  });
});

describe("the shared DateField — the calendar's own popups", () => {
  it("keeps the calendar open while its own month listbox is used", () => {
    const onChange = vi.fn();
    render(
      <DateField value={SELECTED} onChange={onChange} aria-label="Date of birth" />,
    );
    openCalendar();

    const month = screen.getByLabelText("Month") as HTMLSelectElement;
    fireEvent.mouseDown(month);
    const listbox = document.querySelector<HTMLElement>('[role="listbox"]');
    expect(listbox, "the month control offers no listbox of its own").toBeTruthy();
    const option = listbox!.querySelector<HTMLElement>('[role="option"]');
    expect(option, "the month listbox offers no option").toBeTruthy();

    // A press ON the calendar's own listbox must not unmount the picker.
    fireEvent.pointerDown(option!);
    fireEvent.click(option!);

    expect(
      dayCells(document.body).length,
      "choosing a month in the calendar's own listbox unmounted the calendar",
    ).toBeGreaterThan(27);
  });

  it("still dismisses the calendar for a press on an unrelated listbox", () => {
    render(
      <>
        <DateField value={SELECTED} onChange={vi.fn()} aria-label="Date of birth" />
        <div role="listbox" data-testid="unrelated">
          <div role="option" aria-selected={false}>
            Something else
          </div>
        </div>
      </>,
    );
    openCalendar();
    expect(dayCells(document.body).length).toBeGreaterThan(0);

    fireEvent.pointerDown(screen.getByTestId("unrelated"));

    expect(
      dayCells(document.body).length,
      "the calendar stayed open after a press outside the field",
    ).toBe(0);
  });
});

describe("the shared DateField — the header and the popup fit", () => {
  /** The row that holds the two arrows and the two selectors. */
  function headerRow(): HTMLElement {
    const month = screen.getByLabelText("Month");
    let node = month.parentElement;
    while (node) {
      if (
        node.querySelector('[aria-label="Year"]') &&
        node.querySelector('[aria-label="Previous month"]')
      ) {
        return node;
      }
      node = node.parentElement;
    }
    throw new Error("the calendar header row was not found");
  }

  it("lets the header reflow and keeps its buttons reachable (LAYOUT INTENT)", () => {
    render(
      <DateField value={SELECTED} onChange={vi.fn()} aria-label="Date of birth" />,
    );
    openCalendar();

    const row = headerRow();
    const classes = row.getAttribute("class") ?? "";

    // One row that cannot reflow squeezes the month and the year until
    // their text no longer fits. The header must be able to reflow.
    expect(
      /flex-wrap|grid/.test(classes),
      "the header cannot reflow: it lays four controls in one row",
    ).toBe(true);

    // The arrows are hit targets, not decoration.
    for (const label of ["Previous month", "Next month"]) {
      const button = screen.getByLabelText(label);
      const buttonClasses = button.getAttribute("class") ?? "";
      expect(
        /(?:^|\s)(?:min-)?h-(?:11|\[44px\])/.test(buttonClasses),
        `the "${label}" button is smaller than a 44px target`,
      ).toBe(true);
      expect(
        /(?:^|\s)(?:min-)?w-(?:11|\[44px\])/.test(buttonClasses),
        `the "${label}" button is smaller than a 44px target`,
      ).toBe(true);
    }
  });

  it("gives the month and the year room to be read (LAYOUT INTENT)", () => {
    render(
      <DateField value={SELECTED} onChange={vi.fn()} aria-label="Date of birth" />,
    );
    openCalendar();

    // The shared select keeps its own type and padding: the calendar
    // does not shrink the product's control to make room for itself.
    const control = screen.getByLabelText("Month");
    const controlClasses = control.getAttribute("class") ?? "";
    expect(controlClasses, "the shared select lost its own left padding").toContain("pl-4");
    expect(controlClasses, "the shared select lost its own right padding").toContain("pr-9");
    expect(controlClasses, "the shared select lost its own type size").toContain("text-[16px]");

    // And the header adds no smaller type of its own: the month names
    // are read, not guessed at.
    const headerClasses = headerRow().getAttribute("class") ?? "";
    expect(
      /text-\[(?:[0-9]|1[01])px\]/.test(headerClasses),
      "the header shrinks the type to make the controls fit",
    ).toBe(false);
  });

  it("gives the month more of the row than the year (LAYOUT INTENT)", () => {
    render(
      <DateField value={SELECTED} onChange={vi.fn()} aria-label="Date of birth" />,
    );
    openCalendar();

    const monthTrack = trackOf(screen.getByLabelText("Month"));
    const yearTrack = trackOf(screen.getByLabelText("Year"));

    expect(
      trackShare(monthTrack),
      "the month and the year share the row equally: the longest month name (September, November) does not fit beside it",
    ).toBeGreaterThan(trackShare(yearTrack));
  });

  it("sizes the popup to the client viewport, not to the window", () => {
    render(
      <DateField value={SELECTED} onChange={vi.fn()} aria-label="Date of birth" />,
    );
    openCalendar();

    const popup = calendarPopup();
    expect(popup, "the calendar drew no popup").toBeTruthy();
    const width = Number.parseFloat(popup!.style.width || "0");
    expect(
      width,
      "the popup claims more width than the client viewport allows",
    ).toBeLessThanOrEqual(CLIENT_WIDTH - 8);
  });

  it("follows the viewport when it changes", async () => {
    render(
      <DateField value={SELECTED} onChange={vi.fn()} aria-label="Date of birth" />,
    );
    openCalendar();

    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: 260,
    });
    await act(async () => {
      window.dispatchEvent(new Event("resize"));
    });

    const popup = calendarPopup();
    expect(popup, "the calendar drew no popup").toBeTruthy();
    const width = Number.parseFloat(popup!.style.width || "0");
    expect(
      width,
      "the popup kept its old width after the viewport changed",
    ).toBeLessThanOrEqual(260 - 8);
  });

  it("follows the trigger when the page scrolls", async () => {
    // A viewport tall enough for the popup to open BELOW the trigger,
    // so its top is the trigger's own bottom. jsdom cannot measure, so
    // the popup's height is stated.
    Object.defineProperty(document.documentElement, "clientHeight", {
      configurable: true,
      value: 800,
    });
    const original = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetHeight",
    );
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        return 240;
      },
    });

    try {
      render(
        <DateField value={SELECTED} onChange={vi.fn()} aria-label="Date of birth" />,
      );
      const trigger = document.querySelector<HTMLElement>(
        "button[aria-haspopup='dialog']",
      );
      expect(trigger, "the field offers no calendar trigger").toBeTruthy();

      // The trigger's rectangle MOVES when the page scrolls.
      let rect = { top: 100, bottom: 144, left: 40, right: 84 };
      trigger!.getBoundingClientRect = () =>
        ({ ...rect, width: 44, height: 44, x: rect.left, y: rect.top }) as DOMRect;

      fireEvent.click(trigger!);
      const popup = calendarPopup();
      expect(popup, "the calendar drew no popup").toBeTruthy();
      expect(popup!.style.top, "the popup did not open at the trigger").toBe(
        "152px",
      );

      // The page scrolls: the trigger moves up under the reader's finger.
      rect = { top: 20, bottom: 64, left: 40, right: 84 };
      await act(async () => {
        window.dispatchEvent(new Event("scroll"));
      });

      expect(
        popup!.style.top,
        "the popup stayed where the trigger WAS: it must follow the trigger",
      ).toBe("72px");
    } finally {
      if (original) {
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", original);
      } else {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>)
          .offsetHeight;
      }
    }
  });

  it("remeasures its height when the month it shows changes", async () => {
    const original = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetHeight",
    );
    // The popup is as tall as the month it shows: March 2026 runs six
    // week rows, February 2026 five.
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        const rows = (this as HTMLElement).querySelectorAll?.('[role="row"]')
          .length;
        return rows ? rows * 40 : 0;
      },
    });

    try {
      render(
        <DateField value="2026-03-15" onChange={vi.fn()} aria-label="Date of birth" />,
      );
      openCalendar();
      const popup = calendarPopup();
      expect(popup, "the calendar drew no popup").toBeTruthy();
      expect(
        popup!.offsetHeight,
        "the popup did not take the height of the month it shows",
      ).toBe(280);

      fireEvent.change(screen.getByLabelText("Month"), {
        target: { value: "2" },
      });
      await act(async () => {});

      expect(
        popup!.offsetHeight,
        "the popup kept the height of the month it no longer shows",
      ).toBe(240);
    } finally {
      if (original) {
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", original);
      } else {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>)
          .offsetHeight;
      }
    }
  });

  it("does not cut the popup off on a short viewport (LAYOUT INTENT)", () => {
    const original = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "offsetHeight",
    );
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      get() {
        return 420;
      },
    });

    try {
      render(
        <DateField value={SELECTED} onChange={vi.fn()} aria-label="Date of birth" />,
      );
      openCalendar();

      const popup = calendarPopup();
      expect(popup, "the calendar drew no popup").toBeTruthy();
      const top = Number.parseFloat(popup!.style.top || "0");

      // The popup must be BOUNDED: a declared height it cannot exceed,
      // read as a number, and the content below it reachable by
      // scrolling when the month does not fit.
      const bound = numericMaxHeight(popup!);
      const scrollable = hasScrollableOverflow(popup!);
      const fits =
        bound !== null && top + bound <= CLIENT_HEIGHT;
      expect(
        fits || (bound !== null && scrollable),
        "the popup is taller than the viewport and its content cannot be reached",
      ).toBe(true);
    } finally {
      if (original) {
        Object.defineProperty(HTMLElement.prototype, "offsetHeight", original);
      } else {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>)
          .offsetHeight;
      }
    }
  });
});

describe("the shared DateField — the keyboard and the focus", () => {
  it("does not take the header selector's own keys", () => {
    render(
      <DateField value={SELECTED} onChange={vi.fn()} aria-label="Date of birth" />,
    );
    openCalendar();

    const grid = document.querySelector('[role="grid"]');
    const before = rovingDay();
    expect(before, "the calendar has no focused day").toBeTruthy();
    const month = screen.getByLabelText("Month");

    fireEvent.keyDown(month, { key: "ArrowDown" });
    fireEvent.keyDown(month, { key: "PageDown" });

    expect(
      grid?.getAttribute("aria-label"),
      "the calendar took the keys the header selector was handling and moved the month",
    ).toBe("March 2026");
    expect(
      rovingDay()?.getAttribute("aria-label"),
      "the calendar took the keys the header selector was handling and moved the day",
    ).toBe(before?.getAttribute("aria-label"));
  });

  it("tells the consumer when the focus leaves the whole field, and dismisses the popup", () => {
    const onBlur = vi.fn();
    render(<Harness onBlur={onBlur} initial={SELECTED} />);
    openCalendar();
    expect(dayCells(document.body).length).toBeGreaterThan(0);

    fireEvent.focusOut(dateInput(), {
      relatedTarget: screen.getByTestId("outside"),
    });

    expect(
      onBlur,
      "the consumer was never told the edit ended: the blur is suppressed for ever",
    ).toHaveBeenCalled();
    expect(
      dayCells(document.body).length,
      "the popup stayed open after the focus left the whole field",
    ).toBe(0);
  });

  it("does not tell the consumer the edit ended when the focus moves into the calendar", () => {
    const onBlur = vi.fn();
    render(<Harness onBlur={onBlur} initial={SELECTED} />);
    openCalendar();

    fireEvent.focusOut(dateInput(), {
      relatedTarget: dayCells(document.body)[0],
    });

    expect(
      onBlur,
      "moving into the calendar ended the edit: the old value would be saved",
    ).not.toHaveBeenCalled();
  });
});

describe("the shared DateField — the dates the calendar offers", () => {
  it("never offers or emits a day outside the range the product accepts", () => {
    const onChange = vi.fn();
    render(
      <DateField value={SELECTED} onChange={onChange} aria-label="Date of birth" />,
    );
    openCalendar();

    const year = screen.getByLabelText("Year") as HTMLSelectElement;
    fireEvent.change(year, { target: { value: EARLIEST } });
    const month = screen.getByLabelText("Month") as HTMLSelectElement;
    fireEvent.change(month, { target: { value: "1" } });
    expect(year.value).toBe(EARLIEST);

    fireEvent.click(screen.getByLabelText("Previous month"));

    const day = dayCell(document.body, 15);
    expect(day, "the calendar offers no day at all").toBeTruthy();
    fireEvent.click(day!);

    const emitted = String(onChange.mock.calls[0]?.[0] ?? "");
    expect(
      parseCalendarDate(emitted),
      `the calendar emitted "${emitted}", which is not a day the product accepts`,
    ).not.toBeNull();
    expect(
      (year as HTMLSelectElement).value,
      "the calendar walked into a year the product does not accept",
    ).toBe(EARLIEST);
  });

  it("carries the displayed month across a month boundary", () => {
    render(
      <DateField value="2026-03-15" onChange={vi.fn()} aria-label="Date of birth" />,
    );
    openCalendar();

    // 15 March → 31 March, and one step more into the next month.
    for (let step = 0; step < 16; step += 1) {
      fireEvent.keyDown(currentDay(), { key: "ArrowRight" });
    }
    expect(shownMonths()).toEqual(["March 2026"]);
    fireEvent.keyDown(currentDay(), { key: "ArrowRight" });

    expect(
      shownMonths(),
      "the day arrow crossed into the next month without showing it",
    ).toEqual(["April 2026"]);
    expect(
      currentDay().getAttribute("aria-label"),
      "the day arrow crossed into the next month and lost the day",
    ).toBe("1 April 2026");
  });

  it("carries the displayed year across a year boundary", () => {
    render(
      <DateField value="2026-12-15" onChange={vi.fn()} aria-label="Date of birth" />,
    );
    openCalendar();

    for (let step = 0; step < 16; step += 1) {
      fireEvent.keyDown(currentDay(), { key: "ArrowRight" });
    }
    fireEvent.keyDown(currentDay(), { key: "ArrowRight" });

    expect(
      shownMonths(),
      "the day arrow crossed into the next year without showing it",
    ).toEqual(["January 2027"]);
    expect(currentDay().getAttribute("aria-label")).toBe("1 January 2027");
  });

  it("never offers a year outside the four-digit range", () => {
    // The header is asked for the top of the range directly: the year
    // list grows with the year on screen, so a list that is not bounded
    // walks out of the four-digit range. It is rendered on the SERVER
    // here: the list is long, and the assertion is about the values it
    // offers, not about a thousand mutations in the browser.
    const markup = renderToStaticMarkup(
      <DateCalendarHeader
        view={{ year: 9999, month: 3, day: 15 }}
        onViewChange={() => {}}
      />,
    );
    const yearSelect = /aria-label="Year"[\s\S]*?<\/select>/.exec(markup)?.[0] ?? "";
    const years = Array.from(
      yearSelect.matchAll(/<option value="([^"]+)"/g),
      (match) => match[1]!,
    );
    expect(years.length, "the year picker offers no year at all").toBeGreaterThan(0);
    for (const year of years) {
      expect(
        Number(year),
        `the year picker offers "${year}", which is not a four-digit year`,
      ).toBeLessThanOrEqual(9999);
      expect(year.length, `the year "${year}" is not a four-digit year`).toBe(4);
    }
  });
});

describe("the shared DateField — two fields on one screen", () => {
  it("dismisses this field's calendar for a press in another field's calendar", () => {
    render(
      <>
        <DateField value="2026-03-15" onChange={vi.fn()} aria-label="Date of birth" />
        <DateField value="2026-06-15" onChange={vi.fn()} aria-label="Second date" />
      </>,
    );
    const triggers = Array.from(
      document.querySelectorAll<HTMLElement>("button[aria-haspopup='dialog']"),
    );
    expect(triggers.length, "the two fields offer no calendar").toBe(2);
    fireEvent.click(triggers[0]!);
    expect(shownMonths()).toEqual(["March 2026"]);

    // The SECOND field's calendar is opened with the keyboard: a press
    // on its own trigger would have dismissed the first one already.
    fireEvent.keyDown(
      screen.getAllByLabelText("Second date")[0] as HTMLInputElement,
      { key: "Enter" },
    );
    expect(
      shownMonths(),
      "the second field's calendar did not open, so the ownership rule cannot be seen",
    ).toContain("June 2026");

    const june = Array.from(document.querySelectorAll('[role="grid"]')).find(
      (grid) => grid.getAttribute("aria-label") === "June 2026",
    );
    const day = june?.querySelector("button");
    expect(day, "the second field's calendar shows no day").toBeTruthy();
    fireEvent.pointerDown(day!);

    expect(
      shownMonths(),
      "the first field's calendar stayed open for a press in another field's calendar",
    ).not.toContain("March 2026");
  });
});

describe("the shared DateField — the room the value and the icon need", () => {
  it("does not fight the caller's own minimum width", () => {
    render(
      <DateField
        value={SELECTED}
        onChange={vi.fn()}
        aria-label="Date of birth"
        className="h-11 min-w-[140px]"
      />,
    );
    const classes = dateInput().getAttribute("class") ?? "";
    const zeroFloor = /(?:^|\s)min-w-0(?:\s|$)/.test(classes);
    const callerFloor = /(?:^|\s)min-w-\[[0-9.]+px\](?:\s|$)/.test(classes);
    expect(
      zeroFloor && callerFloor,
      "the field's own zero minimum fights the caller's floor: the date value and the 44px icon can be squeezed out",
    ).toBe(false);
  });
});
