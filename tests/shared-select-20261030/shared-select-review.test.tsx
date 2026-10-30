// @vitest-environment jsdom
// Shared custom dropdown — 30 October 2026.
//
// The independent source review (root, 30 October 2026) found eight
// concrete defects in the first implementation. Each one is an
// acceptance detail of the original task, so each gets its own failing
// regression here BEFORE the correction.
//
// These are the intended RED for this round: every assertion below must
// fail against the implementation as it stands.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { Select } from "@/components/ui/Select";

beforeAll(() => {
  // jsdom has no layout engine, so scrollIntoView is not implemented.
  Element.prototype.scrollIntoView = function scrollIntoView() {};
});

afterEach(cleanup);

const OPTIONS = [
  { value: "p1", label: "Pool 1" },
  { value: "p2", label: "Pool 2" },
  { value: "p3", label: "Pool 3" },
];

function control(): HTMLSelectElement {
  return screen.getByLabelText("Facility") as HTMLSelectElement;
}

function openListbox() {
  fireEvent.keyDown(control(), { key: "ArrowDown" });
  return screen.getByRole("listbox");
}

function activeOption(): HTMLElement {
  const id = control().getAttribute("aria-activedescendant");
  const element = id ? document.getElementById(id) : null;
  expect(element, "the control points at the active option").toBeTruthy();
  return element as HTMLElement;
}

describe("review 1 — the typeahead keeps the whole prefix", () => {
  it("matches 'co' after 'c', instead of dropping the first letter", () => {
    render(
      <Select aria-label="Facility" defaultValue="z">
        <option value="z">Zebra</option>
        <option value="cafe">Cafe</option>
        <option value="court">Court</option>
        <option value="cricket">Cricket</option>
      </Select>,
    );
    openListbox();
    fireEvent.keyDown(control(), { key: "c" });
    expect(activeOption().textContent).toContain("Cafe");
    // The second letter EXTENDS the prefix: "co" must reach "Court".
    fireEvent.keyDown(control(), { key: "o" });
    expect(activeOption().textContent).toContain("Court");
  });

  it("still cycles when the same letter is typed again", () => {
    render(
      <Select aria-label="Facility" defaultValue="z">
        <option value="z">Zebra</option>
        <option value="cafe">Cafe</option>
        <option value="court">Court</option>
      </Select>,
    );
    openListbox();
    fireEvent.keyDown(control(), { key: "c" });
    expect(activeOption().textContent).toContain("Cafe");
    fireEvent.keyDown(control(), { key: "c" });
    expect(activeOption().textContent).toContain("Court");
  });
});

describe("review 2 — a disabled group disables its options", () => {
  function renderGrouped() {
    return render(
      <Select aria-label="Facility">
        <option value="p1">Pool 1</option>
        <optgroup label="Closed pools" disabled>
          <option value="p2">Pool 2</option>
        </optgroup>
        <option value="p3">Pool 3</option>
      </Select>,
    );
  }

  it("marks an option of a disabled group as disabled", () => {
    renderGrouped();
    const listbox = openListbox();
    const options = within(listbox).getAllByRole("option");
    expect(options[1]?.textContent).toContain("Pool 2");
    expect(options[1]?.getAttribute("aria-disabled")).toBe("true");
  });

  it("skips an option of a disabled group on the keyboard", () => {
    renderGrouped();
    openListbox();
    fireEvent.keyDown(control(), { key: "ArrowDown" });
    expect(activeOption().textContent).toContain("Pool 3");
  });

  it("does not choose an option of a disabled group on a click", () => {
    const onChange = vi.fn();
    render(
      <Select aria-label="Facility" onChange={onChange}>
        <option value="p1">Pool 1</option>
        <optgroup label="Closed pools" disabled>
          <option value="p2">Pool 2</option>
        </optgroup>
      </Select>,
    );
    const listbox = openListbox();
    const options = within(listbox).getAllByRole("option");
    fireEvent.click(options[1] as HTMLElement);
    expect(onChange).not.toHaveBeenCalled();
    expect(control().value).toBe("p1");
  });
});

describe("review 3 — a value changed from outside follows the open popup", () => {
  it("moves the mark when the controlled value changes while the popup is open", () => {
    function Controlled() {
      const [value, setValue] = useState("p1");
      return (
        <>
          <button type="button" onClick={() => setValue("p3")}>
            change
          </button>
          <Select
            aria-label="Facility"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          >
            {OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </>
      );
    }
    render(<Controlled />);
    const listbox = openListbox();
    let options = within(listbox).getAllByRole("option");
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");
    expect(options[0]?.querySelector("svg")).toBeTruthy();

    // The value changes from outside the control: React sets the value
    // property, which is neither a change event nor an attribute
    // mutation.
    fireEvent.click(screen.getByRole("button", { name: "change" }));

    options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options[2]?.getAttribute("aria-selected")).toBe("true");
    expect(options[2]?.querySelector("svg")).toBeTruthy();
    expect(options[0]?.getAttribute("aria-selected")).toBe("false");
  });
});

describe("review 4 — the consumer's own press handlers still run", () => {
  it("calls the consumer's onMouseDown and onClick", () => {
    const onMouseDown = vi.fn();
    const onClick = vi.fn();
    render(
      <Select
        aria-label="Facility"
        onMouseDown={onMouseDown}
        onClick={onClick}
      >
        <option value="p1">Pool 1</option>
      </Select>,
    );
    fireEvent.mouseDown(control());
    expect(onMouseDown).toHaveBeenCalledTimes(1);
    fireEvent.click(control());
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("still cancels the browser's own dropdown when the consumer handles the press", () => {
    const onMouseDown = vi.fn((event: React.MouseEvent) => event.preventDefault());
    render(
      <Select aria-label="Facility" onMouseDown={onMouseDown}>
        <option value="p1">Pool 1</option>
      </Select>,
    );
    // The press is cancelled, so the operating system's picker cannot
    // open…
    expect(fireEvent.mouseDown(control())).toBe(false);
    // …but the consumer handled it, so our popup stays closed.
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});

describe("review 5 — the marked option is scrolled into view", () => {
  it("scrolls the highlighted option into the listbox", () => {
    const scrolled: Element[] = [];
    Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
      scrolled.push(this);
    };
    render(
      <Select aria-label="Facility">
        {Array.from({ length: 30 }, (_, index) => (
          <option key={index} value={`p${index}`}>
            {`Pool ${index}`}
          </option>
        ))}
      </Select>,
    );
    openListbox();
    fireEvent.keyDown(control(), { key: "End" });
    const active = activeOption();
    expect(scrolled).toContain(active);
  });
});

describe("review 6 — Escape closes the popup and only the popup", () => {
  it("does not reach the consumer or an enclosing dialog while the popup is open", () => {
    const onKeyDown = vi.fn();
    const onParentKeyDown = vi.fn();
    render(
      // A dialog (or any layer) around the control.
      <div onKeyDown={onParentKeyDown}>
        <Select aria-label="Facility" onKeyDown={onKeyDown}>
          <option value="p1">Pool 1</option>
        </Select>
      </div>,
    );
    openListbox();
    // The key that opened the popup is the page's own business; from
    // here on, the Escape must reach nobody but the popup.
    onKeyDown.mockClear();
    onParentKeyDown.mockClear();
    // The press is cancelled, so the browser does not act on it either.
    expect(fireEvent.keyDown(control(), { key: "Escape" })).toBe(false);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onKeyDown).not.toHaveBeenCalled();
    expect(onParentKeyDown).not.toHaveBeenCalled();
  });

  it("still reaches the consumer when there is no popup to close", () => {
    const onKeyDown = vi.fn();
    render(
      <Select aria-label="Facility" onKeyDown={onKeyDown}>
        <option value="p1">Pool 1</option>
      </Select>,
    );
    fireEvent.keyDown(control(), { key: "Escape" });
    expect(onKeyDown).toHaveBeenCalledTimes(1);
  });
});

describe("review 7 — the listbox has a proper name", () => {
  it("names the listbox after the control it belongs to", () => {
    render(
      <Select aria-label="Facility">
        <option value="p1">Pool 1</option>
      </Select>,
    );
    openListbox();
    expect(screen.getByRole("listbox", { name: "Facility options" })).toBeTruthy();
  });

  it("takes the name from the control's label when it has one", () => {
    render(
      <>
        <label htmlFor="facility">Facility</label>
        <Select id="facility">
          <option value="p1">Pool 1</option>
        </Select>
      </>,
    );
    fireEvent.keyDown(screen.getByLabelText("Facility"), { key: "ArrowDown" });
    expect(screen.getByRole("listbox", { name: "Facility options" })).toBeTruthy();
  });
});

describe("review 8 — the option rows wear the shared radius", () => {
  it("uses the control radius token, not a new literal", () => {
    render(
      <Select aria-label="Facility">
        <option value="p1">Pool 1</option>
      </Select>,
    );
    const listbox = openListbox();
    const option = within(listbox).getAllByRole("option")[0];
    expect(option?.className).toContain("rounded-ctl");
    expect(option?.className).not.toContain("rounded-[10px]");
  });
});

describe("review 9 — a choice that does not exist changes nothing", () => {
  it("does not change the value when nothing can be chosen", () => {
    const onChange = vi.fn();
    render(
      <Select aria-label="Facility" onChange={onChange}>
        <option value="p1" disabled>
          Pool 1
        </option>
      </Select>,
    );
    // Every option is disabled, so there is nothing to choose and the
    // control holds nothing.
    const before = control().value;
    fireEvent.keyDown(control(), { key: "ArrowDown" });
    fireEvent.keyDown(control(), { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    expect(control().value).toBe(before);
  });
});
