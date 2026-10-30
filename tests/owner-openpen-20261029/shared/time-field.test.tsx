// @vitest-environment jsdom
//
// Shared TimeField — canonical serialization, empty/partial/invalid,
// midnight/noon, controlled reset, labels/ARIA/disabled/error and form names.

import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TimeField } from "@/components/ui/TimeField";

afterEach(cleanup);

function Harness({
  initial = "",
  onChange,
}: {
  initial?: string;
  onChange?: (value: string) => void;
}) {
  const [value, setValue] = useState(initial);
  return (
    <div>
      <TimeField
        id="shift-start"
        label="Shift start"
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange?.(next);
        }}
        name="start_time"
        data-testid="time-field"
      />
      <p data-testid="time-value">{value}</p>
      <button type="button" onClick={() => setValue("18:45")}>
        Set evening
      </button>
      <button type="button" onClick={() => setValue("")}>
        Reset
      </button>
    </div>
  );
}

function select(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("TimeField — canonical 24-hour serialization", () => {
  it("maps midnight and noon correctly", () => {
    render(<Harness initial="00:00" />);
    expect((screen.getByLabelText("Hour") as HTMLSelectElement).value).toBe("12");
    expect((screen.getByLabelText("AM/PM") as HTMLSelectElement).value).toBe("AM");
    select("AM/PM", "PM");
    expect(screen.getByTestId("time-value").textContent).toBe("12:00");
    select("AM/PM", "AM");
    expect(screen.getByTestId("time-value").textContent).toBe("00:00");
  });

  it("serializes 11:59 PM, 1 PM and all minutes without an interval", () => {
    render(<Harness initial="23:59" />);
    const minutes = screen.getByLabelText("Minutes") as HTMLSelectElement;
    expect(minutes.options).toHaveLength(61);
    expect(Array.from(minutes.options).slice(1).map((option) => option.value)).toEqual(
      Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0")),
    );
    expect((screen.getByLabelText("Hour") as HTMLSelectElement).value).toBe("11");
    expect(minutes.value).toBe("59");
    expect((screen.getByLabelText("AM/PM") as HTMLSelectElement).value).toBe("PM");
    select("Hour", "1");
    expect(screen.getByTestId("time-value").textContent).toBe("13:59");
    select("Minutes", "00");
    expect(screen.getByTestId("time-value").textContent).toBe("13:00");
    select("Hour", "12");
    select("AM/PM", "AM");
    expect(screen.getByTestId("time-value").textContent).toBe("00:00");
  });
});

describe("TimeField — empty, partial and invalid", () => {
  it("emits empty for partial entry and does not retain the old valid value", () => {
    render(<Harness initial="07:00" />);
    select("Hour", "");
    expect(screen.getByTestId("time-value").textContent).toBe("");
    select("Minutes", "30");
    expect(screen.getByTestId("time-value").textContent).toBe("");
    select("Hour", "7");
    expect(screen.getByTestId("time-value").textContent).toBe("07:30");
  });

  it("renders an invalid canonical prop as empty, not stale", () => {
    render(
      <TimeField
        id="invalid-time"
        label="Start time"
        value="25:00"
        onChange={vi.fn()}
        data-testid="invalid-field"
      />,
    );
    expect((screen.getByLabelText("Hour") as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText("Minutes") as HTMLSelectElement).value).toBe("");
    expect(
      screen.getByRole("group", { name: /start time/i }).getAttribute("aria-invalid"),
    ).toBe("true");
  });
});

describe("TimeField — controlled reset and naming", () => {
  it("follows parent updates and clears on reset", () => {
    render(<Harness initial="07:00" />);
    fireEvent.click(screen.getByRole("button", { name: "Set evening" }));
    expect((screen.getByLabelText("Hour") as HTMLSelectElement).value).toBe("6");
    expect((screen.getByLabelText("Minutes") as HTMLSelectElement).value).toBe("45");
    expect((screen.getByLabelText("AM/PM") as HTMLSelectElement).value).toBe("PM");
    expect(screen.getByTestId("time-value").textContent).toBe("18:45");

    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect((screen.getByLabelText("Hour") as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText("Minutes") as HTMLSelectElement).value).toBe("");
    expect((screen.getByLabelText("AM/PM") as HTMLSelectElement).value).toBe("");
    expect(screen.getByTestId("time-value").textContent).toBe("");
  });

  it("serializes the canonical value through the form name", () => {
    const { container } = render(
      <TimeField
        id="named-time"
        label="Start time"
        value="18:05"
        onChange={vi.fn()}
        name="start_time"
      />,
    );
    const hidden = container.querySelector(
      'input[type="hidden"][name="start_time"]',
    ) as HTMLInputElement;
    expect(hidden.value).toBe("18:05");
  });
});

describe("TimeField — one labelled group with forwarded state", () => {
  it("forwards required, disabled, descriptions, errors and external aria", () => {
    const { container } = render(
      <TimeField
        id="strict-time"
        label="Start time"
        value="07:00"
        onChange={vi.fn()}
        name="start_time"
        description="Use the academy's local time."
        error="Choose a start time."
        required
        disabled
        aria-describedby="external-help"
        data-testid="strict-field"
      />,
    );
    const group = screen.getByRole("group", { name: /start time/i });
    expect(group.getAttribute("aria-invalid")).toBe("true");
    expect(group.getAttribute("aria-required")).toBe("true");
    for (const label of ["Hour", "Minutes", "AM/PM"]) {
      expect((screen.getByLabelText(label) as HTMLSelectElement).disabled).toBe(true);
    }
    const describedBy = group.getAttribute("aria-describedby") ?? "";
    expect(describedBy).toContain("external-help");
    expect(describedBy).toContain("strict-time-description");
    expect(describedBy).toContain("strict-time-help");
    expect(describedBy).toContain("strict-time-error");
    expect(screen.getByRole("alert").textContent).toContain("Choose a start time.");
    expect(
      (container.querySelector('input[name="start_time"]') as HTMLInputElement).value,
    ).toBe("07:00");
  });
});

describe("TimeField — optional and required validity", () => {
  function ValidForm({ required = false, onValidityChange }: { required?: boolean; onValidityChange?: (valid: boolean) => void }) {
    const [value, setValue] = useState("");
    return (
      <form>
        <TimeField
          id="validity-time"
          label="Window"
          value={value}
          onChange={setValue}
          required={required}
          onValidityChange={onValidityChange}
        />
        <button type="submit">Save</button>
      </form>
    );
  }

  it("treats a fully empty optional window as valid, but partial entry as invalid", () => {
    const { container } = render(<ValidForm />);
    const form = container.querySelector("form")!;
    expect(form.checkValidity()).toBe(true);
    select("Hour", "8");
    expect(form.checkValidity()).toBe(false);
    expect(
      screen.getByRole("group", { name: /window/i }).getAttribute("aria-invalid"),
    ).toBe("true");
    select("Minutes", "00");
    select("AM/PM", "AM");
    expect(form.checkValidity()).toBe(true);
  });

  it("treats an empty required window as invalid", () => {
    const { container } = render(<ValidForm required />);
    expect(container.querySelector("form")!.checkValidity()).toBe(false);
  });

  it("reports validity changes for an imperative submit button", async () => {
    const onValidityChange = vi.fn();
    render(<ValidForm onValidityChange={onValidityChange} />);
    await waitFor(() => expect(onValidityChange).toHaveBeenLastCalledWith(true));
    select("Hour", "8");
    await waitFor(() => expect(onValidityChange).toHaveBeenLastCalledWith(false));
    select("Minutes", "00");
    select("AM/PM", "PM");
    await waitFor(() => expect(onValidityChange).toHaveBeenLastCalledWith(true));
  });
});
