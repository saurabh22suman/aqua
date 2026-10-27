// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// UI foundation — the copied-source primitives.
//
// These are the shadcn-style wrappers the foundation owns (Button and
// the status/table/empty primitives already existed; these are the
// missing ones). Each test pins the behaviour a page relies on:
// association, keyboard, focus, disabled/pending and error handling —
// not a class string.
//
// RED status at the time of writing (develop b22b3cd + inherited
// overlay): none of these modules existed, so the file failed to
// resolve its imports — the surface under test was absent.

import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/Card";
import { Checkbox } from "@/components/ui/Checkbox";
import { Dialog } from "@/components/ui/Dialog";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { InlineFeedback } from "@/components/ui/InlineFeedback";
import { Label } from "@/components/ui/Label";
import { Menu } from "@/components/ui/Menu";
import { Pagination } from "@/components/ui/Pagination";
import { Select } from "@/components/ui/Select";
import { Switch } from "@/components/ui/Switch";
import { Tabs } from "@/components/ui/Tabs";
import { Textarea } from "@/components/ui/Textarea";
import { ToastProvider, useToast } from "@/components/ui/Toast";

afterEach(cleanup);

describe("Input and Textarea", () => {
  it("keeps 16px text (no iOS zoom on focus) and the 48px standard control height", () => {
    // Owner redesign, 27 October 2026: the human approved ONE standard
    // control — "Standard action buttons, text fields, selects, date and
    // time pickers share a 48px height, 10px radius, 16px control text
    // and consistent horizontal padding. Long actions may wrap and
    // grow; do not clip them to meet a numeric height. Compact
    // table/tertiary controls retain at least 44px effective targets."
    //
    // This assertion therefore MOVED from the 44px floor to the 48px
    // standard. It is stricter, not weaker: the input may no longer
    // render below 48px, and the 16px text rule is unchanged.
    render(<Input aria-label="Phone" />);
    const input = screen.getByLabelText("Phone");
    expect(input.className).toContain("text-[16px]");
    expect(input.className).toContain("min-h-12");
  });

  it("marks an invalid input for assistive technology", () => {
    render(<Input aria-label="Phone" invalid />);
    expect(screen.getByLabelText("Phone").getAttribute("aria-invalid")).toBe("true");
  });

  it("renders a textarea with the same metrics", () => {
    render(<Textarea aria-label="Notes" />);
    const textarea = screen.getByLabelText("Notes");
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea.className).toContain("text-[16px]");
  });
});

describe("Label and Field", () => {
  it("associates a label with its control", () => {
    render(
      <>
        <Label htmlFor="phone">Phone</Label>
        <Input id="phone" />
      </>,
    );
    expect(screen.getByLabelText("Phone")).toBeTruthy();
  });

  it("wires the label, the description and the error to the control", () => {
    render(
      <Field
        id="phone"
        label="Phone"
        description="Used for attendance reminders."
        error="Enter a 10 digit number."
        required
      >
        {(field) => <Input {...field} />}
      </Field>,
    );

    const input = screen.getByLabelText(/Phone/);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.hasAttribute("required")).toBe(true);

    const describedBy = input.getAttribute("aria-describedby") ?? "";
    expect(describedBy).toContain("phone-description");
    expect(describedBy).toContain("phone-error");

    // The error is announced next to the field, not only in a summary.
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Enter a 10 digit number.");
  });

  it("marks a required field for assistive technology", () => {
    render(
      <Field id="name" label="Name" required>
        {(field) => <Input {...field} />}
      </Field>,
    );
    const input = screen.getByLabelText(/Name/);
    expect(input.getAttribute("aria-required")).toBe("true");
  });
});

describe("Select and Checkbox", () => {
  it("renders a native select with its options", () => {
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

  it("renders a real checkbox that toggles", () => {
    const onCheckedChange = vi.fn();
    render(
      <Checkbox aria-label="Include inactive" onCheckedChange={onCheckedChange} />,
    );
    const box = screen.getByLabelText("Include inactive") as HTMLInputElement;
    expect(box.type).toBe("checkbox");
    box.click();
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });
});

describe("Switch", () => {
  it("exposes switch semantics and reports the new state", () => {
    const onCheckedChange = vi.fn();
    render(
      <Switch
        label="Attendance reminders"
        checked={false}
        onCheckedChange={onCheckedChange}
      />,
    );
    const control = screen.getByRole("switch", { name: "Attendance reminders" });
    expect(control.getAttribute("aria-checked")).toBe("false");
    control.click();
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("does not fire while disabled", () => {
    const onCheckedChange = vi.fn();
    render(
      <Switch
        label="Attendance reminders"
        checked={false}
        disabled
        onCheckedChange={onCheckedChange}
      />,
    );
    screen.getByRole("switch").click();
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});

describe("Tabs", () => {
  it("marks the active tab and moves with the arrow keys", () => {
    const onValueChange = vi.fn();
    render(
      <Tabs
        label="Fees"
        value="dues"
        onValueChange={onValueChange}
        tabs={[
          { value: "overview", label: "Overview" },
          { value: "dues", label: "Dues" },
          { value: "transactions", label: "Transactions" },
        ]}
      />,
    );

    const list = screen.getByRole("tablist", { name: "Fees" });
    const tabs = within(list).getAllByRole("tab");
    expect(tabs).toHaveLength(3);
    expect(tabs[1]!.getAttribute("aria-selected")).toBe("true");
    // Only the selected tab is in the tab order; the arrow keys move
    // between them (roving tabindex).
    expect(tabs[1]!.getAttribute("tabindex")).toBe("0");
    expect(tabs[0]!.getAttribute("tabindex")).toBe("-1");

    tabs[1]!.focus();
    tabs[1]!.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    expect(onValueChange).toHaveBeenCalledWith("transactions");
  });
});

describe("Dialog", () => {
  it("opens as a modal dialog and closes on cancel", () => {
    const onOpenChange = vi.fn();
    render(
      <Dialog
        open
        onOpenChange={onOpenChange}
        title="Mark churned"
        description="This cannot be undone."
      >
        <p>Body</p>
      </Dialog>,
    );

    const dialog = screen.getByRole("dialog", { name: "Mark churned" });
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(dialog.textContent).toContain("This cannot be undone.");

    dialog.dispatchEvent(new Event("cancel", { bubbles: true }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("returns focus to the trigger when it closes", () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>
            Open
          </button>
          <Dialog
            open={open}
            onOpenChange={setOpen}
            title="Mark churned"
            description="This cannot be undone."
          >
            <p>Body</p>
          </Dialog>
        </>
      );
    }
    render(<Harness />);

    const trigger = screen.getByRole("button", { name: "Open" });
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole("dialog", { name: "Mark churned" });
    dialog.dispatchEvent(new Event("close", { bubbles: true }));
    expect(document.activeElement).toBe(trigger);
  });
});

describe("Menu", () => {
  it("opens, lists its items and closes on Escape", () => {
    const onSelect = vi.fn();
    render(
      <Menu
        label="Account"
        trigger={<span>Account</span>}
        items={[
          { label: "Profile", onSelect },
          { label: "Sign out", onSelect },
        ]}
      />,
    );

    const trigger = screen.getByRole("button", { name: "Account" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    const menu = screen.getByRole("menu", { name: "Account" });
    const items = within(menu).getAllByRole("menuitem");
    expect(items).toHaveLength(2);

    fireEvent.click(items[0]!);
    expect(onSelect).toHaveBeenCalled();

    trigger.focus();
    trigger.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("Toast", () => {
  it("announces a toast in a live region", () => {
    function Harness() {
      const { toast } = useToast();
      return (
        <button type="button" onClick={() => toast({ title: "Payment recorded" })}>
          Record
        </button>
      );
    }
    render(
      <ToastProvider>
        <Harness />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Payment recorded");
  });
});

describe("Pagination", () => {
  it("marks the current page and disables the previous control on page one", () => {
    const onPageChange = vi.fn();
    render(
      <Pagination page={1} pageCount={4} onPageChange={onPageChange} />,
    );
    const nav = screen.getByRole("navigation", { name: "Pagination" });
    expect(within(nav).getByText("Page 1 of 4")).toBeTruthy();
    const previous = within(nav).getByRole("button", { name: "Previous page" });
    expect(previous.hasAttribute("disabled")).toBe(true);
    within(nav).getByRole("button", { name: "Next page" }).click();
    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});

describe("Card and Badge", () => {
  it("renders the card parts", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Today</CardTitle>
          <CardDescription>Sun, 25 Oct 2026</CardDescription>
        </CardHeader>
        <CardContent>
          <p>Classes</p>
        </CardContent>
      </Card>,
    );
    expect(screen.getByText("Today")).toBeTruthy();
    expect(screen.getByText("Sun, 25 Oct 2026")).toBeTruthy();
    expect(screen.getByText("Classes")).toBeTruthy();
  });

  it("renders a badge with its label", () => {
    render(<Badge>Paid</Badge>);
    expect(screen.getByText("Paid")).toBeTruthy();
  });
});

describe("InlineFeedback", () => {
  it("announces an inline message", () => {
    render(<InlineFeedback tone="error">Could not save — try again.</InlineFeedback>);
    expect(screen.getByRole("alert").textContent).toContain("Could not save");
  });
});
