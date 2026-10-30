// @vitest-environment jsdom
// Shared custom dropdown — 30 October 2026.
//
// The contract the custom popup must NOT break. The shared `Select` is
// used by every form in the product, so the control that opens a custom
// listbox still has to BE the native control: the same element, the
// same ref, the same options, the same form value, the same blur and
// key handlers.
//
// Most of these assertions pass today and must keep passing after the
// popup arrives — that is the point of the file. The ones that fail
// today are marked.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { createRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Select } from "@/components/ui/Select";
import { InlineEditControl } from "@/components/member-detail/inline-edit-control";

afterEach(cleanup);

const OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
];

describe("the shared select keeps its native contract", () => {
  it("puts the ref on the real native select and lets the caller focus it", () => {
    const ref = createRef<HTMLSelectElement>();
    render(
      <Select aria-label="Facility" ref={ref}>
        <option value="all">All facilities</option>
      </Select>,
    );
    const select = screen.getByLabelText("Facility");
    expect(ref.current).toBe(select);
    ref.current?.focus();
    expect(document.activeElement).toBe(select);
  });

  it("keeps the native options on the native select", () => {
    render(
      <Select aria-label="Facility">
        <option value="all">All facilities</option>
        <option value="p1">Pool 1</option>
      </Select>,
    );
    const select = screen.getByLabelText("Facility");
    expect(select.tagName).toBe("SELECT");
    expect(within(select).getAllByRole("option")).toHaveLength(2);
  });

  it("still submits its name and value with the form", () => {
    render(
      <form>
        <Select aria-label="Facility" name="facility" defaultValue="p1">
          <option value="all">All facilities</option>
          <option value="p1">Pool 1</option>
        </Select>
      </form>,
    );
    const select = screen.getByLabelText("Facility") as HTMLSelectElement;
    const data = new FormData(select.closest("form") as HTMLFormElement);
    expect(data.get("facility")).toBe("p1");
  });

  it("keeps a controlled value controlled", () => {
    function Controlled() {
      const [value, setValue] = useState("female");
      return (
        <Select aria-label="gender" value={value} onChange={(e) => setValue(e.target.value)}>
          {OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      );
    }
    render(<Controlled />);
    const select = screen.getByLabelText("gender") as HTMLSelectElement;
    expect(select.value).toBe("female");
    fireEvent.change(select, { target: { value: "other" } });
    expect(select.value).toBe("other");
  });

  it("keeps the consumer's blur and key handlers", () => {
    const onBlur = vi.fn();
    const onKeyDown = vi.fn();
    render(
      <Select aria-label="Facility" onBlur={onBlur} onKeyDown={onKeyDown}>
        <option value="all">All facilities</option>
      </Select>,
    );
    const select = screen.getByLabelText("Facility");
    fireEvent.blur(select);
    fireEvent.keyDown(select, { key: "Escape" });
    expect(onBlur).toHaveBeenCalled();
    expect(onKeyDown).toHaveBeenCalled();
  });

  it("keeps the shared control metrics on the select itself", () => {
    render(
      <Select aria-label="Facility">
        <option value="all">All facilities</option>
      </Select>,
    );
    const select = screen.getByLabelText("Facility");
    expect(select.className).toContain("min-h-12");
    expect(select.className).toContain("rounded-ctl");
    expect(select.className).toContain("text-[16px]");
  });

  it("picks up options that arrive later (RED today)", () => {
    function Late() {
      const [loaded, setLoaded] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setLoaded(true)}>
            load
          </button>
          <Select aria-label="Facility">
            <option value="all">All facilities</option>
            {loaded ? <option value="p1">Pool 1</option> : null}
          </Select>
        </>
      );
    }
    render(<Late />);
    fireEvent.click(screen.getByRole("button", { name: "load" }));
    fireEvent.keyDown(screen.getByLabelText("Facility"), { key: "ArrowDown" });
    const listbox = screen.getByRole("listbox");
    expect(
      within(listbox)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["All facilities", "Pool 1"]);
  });

  it("follows a form reset back to the default (RED today)", () => {
    render(
      <form>
        <Select aria-label="Facility" name="facility" defaultValue="all">
          <option value="all">All facilities</option>
          <option value="p1">Pool 1</option>
        </Select>
      </form>,
    );
    const select = screen.getByLabelText("Facility") as HTMLSelectElement;
    select.value = "p1";
    (select.closest("form") as HTMLFormElement).reset();
    expect(select.value).toBe("all");
    fireEvent.keyDown(select, { key: "ArrowDown" });
    const options = within(screen.getByRole("listbox")).getAllByRole("option");
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");
    expect(options[1]?.getAttribute("aria-selected")).toBe("false");
  });

  it("falls back to the native control for a multiple select (RED today)", () => {
    render(
      <Select aria-label="Facility" multiple>
        <option value="all">All facilities</option>
        <option value="p1">Pool 1</option>
      </Select>,
    );
    const select = screen.getByLabelText("Facility");
    fireEvent.keyDown(select, { key: "ArrowDown" });
    // A multiple select keeps the browser's own list box: the shared
    // popup never opens for it, so the control carries none of the
    // popup's wiring.
    expect(select.getAttribute("aria-expanded")).toBeNull();
    expect(select.getAttribute("aria-controls")).toBeNull();
    expect(select.getAttribute("aria-activedescendant")).toBeNull();
  });
});

describe("the inline editor keeps its cancel and commit behaviour", () => {
  it("puts the ref on the native select and saves on change", () => {
    const ref = createRef<HTMLSelectElement>();
    const onDraftChange = vi.fn();
    const onCommit = vi.fn();
    render(
      <InlineEditControl
        field="gender"
        type="select"
        draft=""
        options={OPTIONS}
        inputRef={ref}
        onDraftChange={onDraftChange}
        onCommit={onCommit}
        onBlur={vi.fn()}
        onKeyDown={vi.fn()}
      />,
    );
    const select = screen.getByLabelText("gender") as HTMLSelectElement;
    expect(ref.current).toBe(select);
    expect(ref.current?.tagName).toBe("SELECT");
    fireEvent.change(select, { target: { value: "other" } });
    expect(onDraftChange).toHaveBeenCalledWith("other");
    expect(onCommit).toHaveBeenCalledWith("other");
  });

  it("still lets the keyboard change the inline value through the custom popup (RED today)", () => {
    const onDraftChange = vi.fn();
    const onCommit = vi.fn();
    render(
      <InlineEditControl
        field="gender"
        type="select"
        draft="male"
        options={OPTIONS}
        inputRef={createRef<HTMLSelectElement>()}
        onDraftChange={onDraftChange}
        onCommit={onCommit}
        onBlur={vi.fn()}
        onKeyDown={vi.fn()}
      />,
    );
    const select = screen.getByLabelText("gender");
    fireEvent.keyDown(select, { key: "ArrowDown" });
    fireEvent.keyDown(select, { key: "ArrowDown" });
    fireEvent.keyDown(select, { key: "Enter" });
    expect(onCommit).toHaveBeenCalledWith("female");
  });
});
