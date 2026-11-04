// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { Select } from "@/components/ui/Select";

// Owner redesign · System lane — the shared Select's ref.
//
// The People lane's interface request R5: an INLINE select (a control in
// a table row) needs a ref to the underlying `<select>` — to focus it
// after a row action, or to read its value imperatively.
//
// The shared primitive has to offer that. Today the shared `Select` is a
// plain function component: its public props type does NOT accept a
// `ref`, so a caller cannot even express the request in TypeScript, and
// any ref that did arrive would only reach the `<select>` by accident
// of the props spread.
//
// RED status at the time of writing: `pnpm typecheck` rejects
// `<Select ref={...} />` with "Property 'ref' does not exist on type
// 'SelectProps'", and the primitive has no way to forward one.

afterEach(cleanup);

describe("the shared Select", () => {
  it("accepts a ref and lands it on the underlying select", () => {
    const ref = createRef<HTMLSelectElement>();
    render(
      <Select aria-label="Facility" ref={ref}>
        <option value="all">All facilities</option>
        <option value="p1">Pool 1</option>
      </Select>,
    );
    const select = screen.getByLabelText("Facility");
    expect(ref.current).toBe(select);
  });

  it("lets the caller focus the select through that ref", () => {
    const ref = createRef<HTMLSelectElement>();
    render(
      <Select aria-label="Facility" ref={ref}>
        <option value="all">All facilities</option>
      </Select>,
    );
    ref.current?.focus();
    expect(document.activeElement).toBe(screen.getByLabelText("Facility"));
  });
});
