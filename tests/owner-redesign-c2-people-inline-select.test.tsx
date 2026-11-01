// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner redesign · People lane (C2) — the inline editor's select.
//
// R5 (interface request) — the shared `Select` now forwards its ref to
// the NATIVE `<select>` (reviewed shared refresh
// 20261027T175441Z, components/ui/Select.tsx
// e00d18b967dc2e9d0388a3ef99c7f78891a3c2159c78fcb628cfd5c9baef3fe1).
// That lets the inline editor use the shared primitive, so the last raw
// control in the owned scope goes away.
//
// This test pins the behaviour the migration must not break:
//   * the ref lands on the native select (so the editor can focus it);
//   * a choice saves on change, with no blur step;
//   * the draft and the commit callbacks both fire;
//   * the control keeps its accessible name and the native options.

import { InlineEditControl } from "@/components/member-detail/inline-edit-control";

const OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
];

afterEach(cleanup);

describe("inline editor select (C2)", () => {
  it("puts the ref on the native select so the editor can focus it", () => {
    const ref = createRef<HTMLSelectElement>();
    render(
      <InlineEditControl
        field="gender"
        type="select"
        draft=""
        options={OPTIONS}
        inputRef={ref}
        onDraftChange={vi.fn()}
        onCommit={vi.fn()}
        onBlur={vi.fn()}
        onKeyDown={vi.fn()}
      />,
    );

    const select = screen.getByLabelText("gender") as HTMLSelectElement;
    expect(ref.current).toBe(select);
    expect(ref.current?.tagName).toBe("SELECT");
  });

  it("keeps the native options and the accessible name", () => {
    render(
      <InlineEditControl
        field="gender"
        type="select"
        draft="female"
        options={OPTIONS}
        inputRef={createRef<HTMLSelectElement>()}
        onDraftChange={vi.fn()}
        onCommit={vi.fn()}
        onBlur={vi.fn()}
        onKeyDown={vi.fn()}
      />,
    );

    const select = screen.getByLabelText("gender") as HTMLSelectElement;
    expect(select.value).toBe("female");
    expect(
      Array.from(select.options).map((option) => option.textContent),
    ).toEqual(["—", "Male", "Female", "Other"]);
  });

  it("saves on change — the draft and the commit both fire", () => {
    const onDraftChange = vi.fn();
    const onCommit = vi.fn();
    render(
      <InlineEditControl
        field="gender"
        type="select"
        draft=""
        options={OPTIONS}
        inputRef={createRef<HTMLSelectElement>()}
        onDraftChange={onDraftChange}
        onCommit={onCommit}
        onBlur={vi.fn()}
        onKeyDown={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("gender"), {
      target: { value: "other" },
    });

    expect(onDraftChange).toHaveBeenCalledWith("other");
    expect(onCommit).toHaveBeenCalledWith("other");
  });

  it("wires the blur and keyboard handlers through to the native control", () => {
    const onBlur = vi.fn();
    const onKeyDown = vi.fn();
    render(
      <InlineEditControl
        field="gender"
        type="select"
        draft=""
        options={OPTIONS}
        inputRef={createRef<HTMLSelectElement>()}
        onDraftChange={vi.fn()}
        onCommit={vi.fn()}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      />,
    );

    const select = screen.getByLabelText("gender");
    fireEvent.blur(select);
    fireEvent.keyDown(select, { key: "Escape" });

    expect(onBlur).toHaveBeenCalled();
    expect(onKeyDown).toHaveBeenCalled();
  });
});
