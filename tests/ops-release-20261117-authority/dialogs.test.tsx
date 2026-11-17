// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StatusTransitionControls } from "@/app/(platform)/ops/tenants/[tenantId]/status-transitions";
import { RemoveSampleDataButton } from "@/app/(platform)/ops/tenants/[tenantId]/remove-sample-data-button";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const transition = vi.hoisted(() => vi.fn());
const remove = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/platform-tenants", () => ({ transitionTenantStatusAction: transition }));
vi.mock("@/lib/actions/platform-remove-sample-data", () => ({ removeSampleDataAction: remove }));
afterEach(() => { cleanup(); transition.mockReset(); remove.mockReset(); });

describe("destructive confirmations", () => {
  it("identifies the exact business in both destructive confirmations", () => {
    const name = "Aqua <North> & Long Business Name";
    const view = render(<StatusTransitionControls tenantId="tenant" tenantName={name} currentStatus="active" canWrite />);
    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));
    expect(within(screen.getByRole("dialog")).getByText(name, { exact: false })).toBeTruthy();
    view.unmount();
    render(<RemoveSampleDataButton tenantId="tenant" tenantName={name} canWrite />);
    fireEvent.click(screen.getByRole("button", { name: "Remove sample data" }));
    expect(within(screen.getByRole("dialog")).getByText(name, { exact: false })).toBeTruthy();
  });
  it("shows completion instead of a repeat destructive confirm after removal", async () => {
    remove.mockResolvedValue({ kind: "ok", counts: { programs: 1 } });
    render(<RemoveSampleDataButton tenantId="tenant" tenantName="Aqua North" canWrite />);
    fireEvent.click(screen.getByRole("button", { name: "Remove sample data" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.submit(within(dialog).getByRole("button", { name: "Confirm removal" }).closest("form")!);
    await within(dialog).findByRole("status");
    expect(within(dialog).queryByRole("button", { name: "Confirm removal" })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Done" })).toBeTruthy();
  });
  it("uses a native dialog and puts required-reason errors inside it", () => {
    render(<StatusTransitionControls tenantId="tenant" tenantName="Aqua North" currentStatus="active" canWrite />);
    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.tagName).toBe("DIALOG");
    fireEvent.click(within(dialog).getByRole("button", { name: /Confirm Suspend/ }));
    expect(within(dialog).getByRole("alert").textContent).toMatch(/reason/i);
    expect(transition).not.toHaveBeenCalled();
  });
  it("requires a separate explicit confirmation before removing sample data", () => {
    render(<RemoveSampleDataButton tenantId="tenant" tenantName="Aqua North" canWrite />);
    fireEvent.click(screen.getByRole("button", { name: "Remove sample data" }));
    const dialog = screen.getByRole("dialog");
    expect(dialog.tagName).toBe("DIALOG");
    expect(within(dialog).getByText(/cannot be undone|irreversible/i)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(remove).not.toHaveBeenCalled();
  });
  it("announces server refusals inside the confirmation", async () => {
    remove.mockResolvedValue({ kind: "lock_active", reason: "real_row_exists", message: "Real data prevents removal." });
    render(<RemoveSampleDataButton tenantId="tenant" tenantName="Aqua North" canWrite />);
    fireEvent.click(screen.getByRole("button", { name: "Remove sample data" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.submit(within(dialog).getByRole("button", { name: "Confirm removal" }).closest("form")!);
    await waitFor(() => expect(within(dialog).getByRole("alert").textContent).toContain("Real data prevents removal"));
  });
  it("holds the status dialog open during a pending confirmed mutation", async () => {
    let resolve!: (value: unknown) => void;
    transition.mockImplementation(() => new Promise((done) => { resolve = done; }));
    render(<StatusTransitionControls tenantId="tenant" tenantName="Aqua North" currentStatus="active" canWrite />);
    fireEvent.click(screen.getByRole("button", { name: "Suspend" }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Review" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /Confirm Suspend/ }));
    expect(transition).toHaveBeenCalledWith("tenant", { targetStatus: "suspended", reason: "Review" });
    expect(within(dialog).getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true);
    fireEvent(dialog, new Event("cancel", { bubbles: false, cancelable: true }));
    expect(dialog.hasAttribute("open")).toBe(true);
    await act(async () => { resolve({ kind: "error", code: "denied", message: "Denied" }); });
    expect(within(dialog).getByRole("alert").textContent).toContain("Denied");
  });
  it("submits the tenant only on confirmation and blocks pending dismissal", async () => {
    let resolve!: (value: unknown) => void;
    remove.mockImplementation(() => new Promise((done) => { resolve = done; }));
    render(<RemoveSampleDataButton tenantId="tenant" tenantName="Aqua North" canWrite />);
    fireEvent.click(screen.getByRole("button", { name: "Remove sample data" }));
    const dialog = screen.getByRole("dialog");
    expect(remove).not.toHaveBeenCalled();
    fireEvent.submit(within(dialog).getByRole("button", { name: "Confirm removal" }).closest("form")!);
    const data = remove.mock.calls[0][1] as FormData;
    expect(data.get("tenantId")).toBe("tenant");
    expect(within(dialog).getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true);
    fireEvent(dialog, new Event("cancel", { bubbles: false, cancelable: true }));
    expect(dialog.hasAttribute("open")).toBe(true);
    await act(async () => { resolve({ kind: "ok", counts: { programs: 1 } }); });
    expect(within(dialog).getByRole("status").textContent).toContain("Removed 1");
  });
  it("does not offer destructive controls to viewers", () => {
    render(<><StatusTransitionControls tenantId="tenant" tenantName="Aqua North" currentStatus="active" canWrite={false} /><RemoveSampleDataButton tenantId="tenant" tenantName="Aqua North" canWrite={false} /></>);
    expect(screen.queryByRole("button", { name: "Suspend" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove sample data" })).toBeNull();
  });
});
