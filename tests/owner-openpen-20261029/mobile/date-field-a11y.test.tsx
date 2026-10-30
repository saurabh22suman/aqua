// @vitest-environment jsdom
//
// Mobile slice (29 Oct 2026) — DateField / Field accessibility integration.
//
// Current DateField shows a placeholder but no persistent format guidance,
// and its internal invalid message has no id/role, so a screen-reader user
// does not get the DD/MM/YYYY rule or the referenced validation text. Field
// already supplies description/error ids through its render prop; DateField
// must accept and merge them without breaking its day-first ISO contract.

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DateField } from "@/components/ui/DateField";
import { Field } from "@/components/ui/Field";

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

  it("is not only a placeholder that disappears once typing starts", () => {
    const input = renderDateField();
    fireEvent.change(input, { target: { value: "12" } });
    expect(input.value).toBe("12");
    expect(screen.getByText(/DD\/MM\/YYYY/)).toBeTruthy();
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

describe("DateField — existing day-first ISO behaviour is preserved", () => {
  it("emits ISO for a complete valid leap date and refuses an invalid one", () => {
    const seen: string[] = [];
    render(
      <DateField
        value=""
        onChange={(iso) => seen.push(iso)}
        aria-label="Leap date"
      />,
    );
    const input = screen.getByLabelText("Leap date") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "29/02/2024" } });
    expect(seen.at(-1)).toBe("2024-02-29");
    expect(input.getAttribute("aria-invalid")).toBeNull();

    fireEvent.change(input, { target: { value: "29/02/2025" } });
    expect(seen.at(-1)).toBe("");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    const alert = screen.getByRole("alert");
    expect(alert.id).toBeTruthy();
    expect(
      (input.getAttribute("aria-describedby") ?? "").split(/\s+/),
    ).toContain(alert.id);
  });

  it("accepts an ISO paste and rejects a year before 1900", () => {
    const seen: string[] = [];
    render(
      <DateField
        value=""
        onChange={(iso) => seen.push(iso)}
        aria-label="Paste date"
      />,
    );
    const input = screen.getByLabelText("Paste date") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2026-10-29" } });
    expect(seen.at(-1)).toBe("2026-10-29");
    fireEvent.change(input, { target: { value: "31/12/1899" } });
    expect(seen.at(-1)).toBe("");
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });
});
