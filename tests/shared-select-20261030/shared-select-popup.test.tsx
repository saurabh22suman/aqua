// @vitest-environment jsdom
// Shared custom dropdown — 30 October 2026 (RED).
//
// The human reported: "the dropdown is not looking good, its using the
// default one, instead of our custom css". The shared `Select` styled
// the CLOSED control but left the OPEN menu to the browser's own
// picker, so every shared select in Owner/Coach/Reception/Ops opened
// the operating system's dropdown.
//
// This file pins the OPEN behaviour of the shared control: one
// custom-styled listbox, our own keyboard model, a visible mark on the
// selected option, and a popup that never lets the browser's own picker
// appear.
//
// The API contract that must survive the change (the real ref, the real
// form value, the real blur/key handlers) is pinned in
// shared-select-contract.test.tsx.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Select } from "@/components/ui/Select";

afterEach(cleanup);

const OPTIONS = [
  { value: "all", label: "All facilities" },
  { value: "p1", label: "Pool 1" },
  { value: "p2", label: "Pool 2" },
];

function renderSelect(props: Partial<React.ComponentProps<typeof Select>> = {}) {
  return render(
    <Select aria-label="Facility" {...props}>
      {OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </Select>,
  );
}

function theControl(): HTMLSelectElement {
  return screen.getByLabelText("Facility") as HTMLSelectElement;
}

function openListbox() {
  fireEvent.keyDown(theControl(), { key: "ArrowDown" });
  return screen.getByRole("listbox");
}

function activeOption(): HTMLElement {
  const id = theControl().getAttribute("aria-activedescendant");
  expect(id, "the open control points at the active option").toBeTruthy();
  const element = document.getElementById(id as string);
  expect(element, "the active option is in the document").toBeTruthy();
  return element as HTMLElement;
}

describe("the shared select opens OUR listbox", () => {
  it("opens a custom listbox with every option, instead of the browser's picker", () => {
    renderSelect();
    const listbox = openListbox();
    expect(
      within(listbox)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["All facilities", "Pool 1", "Pool 2"]);
  });

  it("cancels the pointer press, so the operating system's own dropdown never opens", () => {
    renderSelect();
    // A cancelled press reports false: the browser's default action —
    // opening the native picker — is prevented before it happens.
    expect(fireEvent.mouseDown(theControl())).toBe(false);
    expect(screen.getByRole("listbox")).toBeTruthy();
  });

  it("marks the selected option with a visible mark, not with colour alone", () => {
    renderSelect();
    const listbox = openListbox();
    const options = within(listbox).getAllByRole("option");
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");
    expect(options[0]?.textContent).toContain("All facilities");
    // The mark itself is drawn, so the state is not colour-only.
    expect(options[0]?.querySelector("svg")).toBeTruthy();
    expect(options[1]?.getAttribute("aria-selected")).toBe("false");
    expect(options[1]?.querySelector("svg")).toBeNull();
  });

  it("closes on Escape and leaves the focus on the control", () => {
    renderSelect();
    theControl().focus();
    openListbox();
    fireEvent.keyDown(theControl(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(theControl());
  });

  it("walks the options with the arrow keys and picks the active one with Enter", () => {
    const onChange = vi.fn();
    renderSelect({ onChange });
    openListbox();
    fireEvent.keyDown(theControl(), { key: "ArrowDown" });
    expect(activeOption().textContent).toContain("Pool 1");
    fireEvent.keyDown(theControl(), { key: "ArrowDown" });
    expect(activeOption().textContent).toContain("Pool 2");
    fireEvent.keyDown(theControl(), { key: "Enter" });
    expect(onChange).toHaveBeenCalledTimes(1);
    // A real change event: the target is the control itself.
    expect(onChange.mock.calls[0]?.[0].target.value).toBe("p2");
    expect(theControl().value).toBe("p2");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("skips a disabled option", () => {
    render(
      <Select aria-label="Facility">
        <option value="all">All facilities</option>
        <option value="p1" disabled>
          Pool 1
        </option>
        <option value="p2">Pool 2</option>
      </Select>,
    );
    openListbox();
    fireEvent.keyDown(theControl(), { key: "ArrowDown" });
    expect(activeOption().textContent).toContain("Pool 2");
  });

  it("jumps to the first and the last available option with Home and End", () => {
    render(
      <Select aria-label="Facility">
        <option value="all">All facilities</option>
        <option value="p1">Pool 1</option>
        <option value="p2" disabled>
          Pool 2
        </option>
      </Select>,
    );
    openListbox();
    fireEvent.keyDown(theControl(), { key: "End" });
    expect(activeOption().textContent).toContain("Pool 1");
    fireEvent.keyDown(theControl(), { key: "Home" });
    expect(activeOption().textContent).toContain("All facilities");
  });

  it("moves to the option that starts with the typed letters", () => {
    renderSelect();
    openListbox();
    fireEvent.keyDown(theControl(), { key: "p" });
    expect(activeOption().textContent).toContain("Pool 1");
  });

  it("closes on Tab without trapping the focus", () => {
    renderSelect();
    openListbox();
    fireEvent.keyDown(theControl(), { key: "Tab" });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("closes on a press outside and leaves the value alone", () => {
    const onChange = vi.fn();
    renderSelect({ onChange });
    openListbox();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    expect(theControl().value).toBe("all");
  });

  it("scrolls a long list inside the popup instead of growing past the screen", () => {
    render(
      <Select aria-label="Facility">
        {Array.from({ length: 40 }, (_, index) => (
          <option key={index} value={`p${index}`}>
            {`Pool ${index}`}
          </option>
        ))}
      </Select>,
    );
    const listbox = openListbox();
    expect(listbox.style.maxHeight).toBe("320px");
    expect(listbox.style.overflowY).toBe("auto");
  });

  it("keeps every option's full text, so a long label wraps instead of being cut", () => {
    render(
      <Select aria-label="Facility">
        <option value="long">
          A very long facility name that has to wrap in the popup instead of
          being cut off
        </option>
      </Select>,
    );
    const listbox = openListbox();
    const option = within(listbox).getAllByRole("option")[0];
    expect(option?.textContent).toContain("being cut off");
    expect(option?.className).not.toContain("truncate");
  });

  it("never opens a listbox for a disabled control", () => {
    renderSelect({ disabled: true });
    fireEvent.keyDown(theControl(), { key: "ArrowDown" });
    fireEvent.mouseDown(theControl());
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("tells assistive technology that the popup is open and what is active", () => {
    renderSelect();
    expect(theControl().getAttribute("aria-expanded")).toBeNull();
    openListbox();
    expect(theControl().getAttribute("aria-expanded")).toBe("true");
    expect(theControl().getAttribute("aria-controls")).toBe(
      screen.getByRole("listbox").id,
    );
    expect(theControl().getAttribute("aria-activedescendant")).toBe(
      activeOption().id,
    );
  });
});
