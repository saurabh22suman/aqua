// @vitest-environment jsdom
//
// Shared DateField validity contract (29 Oct 2026).
//
// Optional fully blank is valid; nonempty partial or impossible date is
// invalid and must not be treated as a deliberate blank; required blank is
// invalid. The callback lets an imperative submit (the new-subscription
// consumer) guard its action, while native required/custom validity makes a
// real form refuse the same states.
//
// RED before the DateField edit: the callback is never called and a partial
// or impossible date leaves form.checkValidity() true.

import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DateField } from "@/components/ui/DateField";

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

describe("DateField — optional and required validity", () => {
  it("treats a fully blank optional date as valid", async () => {
    const onValidityChange = vi.fn();
    render(<DateHarness onValidityChange={onValidityChange} />);
    await waitFor(() => expect(onValidityChange).toHaveBeenLastCalledWith(true));
    expect(field().value).toBe("");
    expect(formOf(field()).checkValidity()).toBe(true);
    expect(field().validationMessage).toBe("");
  });

  it("treats nonempty partial text as invalid, not as a deliberate blank", async () => {
    const onValidityChange = vi.fn();
    render(<DateHarness onValidityChange={onValidityChange} />);
    fireEvent.change(field(), { target: { value: "12/1" } });
    expect(field().value).toBe("12/1");
    expect(emitted()).toBe("");
    await waitFor(() => expect(onValidityChange).toHaveBeenLastCalledWith(false));
    expect(
      (screen.getByRole("button", { name: "Start subscription" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(formOf(field()).checkValidity()).toBe(false);
    expect(field().validationMessage).not.toBe("");
  });

  it("treats an impossible complete date as invalid", async () => {
    const onValidityChange = vi.fn();
    render(<DateHarness onValidityChange={onValidityChange} />);
    fireEvent.change(field(), { target: { value: "31/02/2026" } });
    expect(field().value).toBe("31/02/2026");
    await waitFor(() => expect(onValidityChange).toHaveBeenLastCalledWith(false));
    expect(
      (screen.getByRole("button", { name: "Start subscription" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(formOf(field()).checkValidity()).toBe(false);
    expect(field().validationMessage).not.toBe("");
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

  it("reports a valid complete date and emits its ISO value", async () => {
    const onValidityChange = vi.fn();
    render(<DateHarness onValidityChange={onValidityChange} />);
    fireEvent.change(field(), { target: { value: "29/02/2024" } });
    await waitFor(() => expect(onValidityChange).toHaveBeenLastCalledWith(true));
    expect(emitted()).toBe("2024-02-29");
    expect(
      (screen.getByRole("button", { name: "Start subscription" }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(formOf(field()).checkValidity()).toBe(true);
    expect(field().validationMessage).toBe("");
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

    fireEvent.change(field(), { target: { value: "29/02/2024" } });
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

  it("clears stale custom validity when a valid date replaces an impossible one", () => {
    render(<DateHarness />);
    fireEvent.change(field(), { target: { value: "31/02/2026" } });
    expect(field().validationMessage).not.toBe("");
    fireEvent.change(field(), { target: { value: "29/02/2024" } });
    expect(field().validationMessage).toBe("");
    expect(formOf(field()).checkValidity()).toBe(true);
  });
});
