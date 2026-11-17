// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PlanCommercialControls } from "@/components/ops/tenant-controls/plan-commercial-controls";

const assign = vi.hoisted(() => vi.fn());
const deadline = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/platform-tenant-plan", () => ({ assignTenantPlanAction: assign }));
vi.mock("@/lib/actions/platform-tenant-trial", () => ({ setTenantTrialDeadlineAction: deadline }));
afterEach(() => { cleanup(); assign.mockReset(); deadline.mockReset(); });

it("announces unchanged plan distinctly from an applied plan", async () => {
  assign.mockResolvedValue({ kind: "applied", changed: false });
  render(<PlanCommercialControls tenantId="tenant" currentPlanId={null} currentPlanName={null} eligiblePlans={[{ key: "standard", name: "Standard" }]} currentTrialExpiresAt={null} canWrite />);
  fireEvent.change(screen.getByLabelText("Move to plan"), { target: { value: "standard" } });
  fireEvent.change(screen.getByLabelText("Reason for the plan change"), { target: { value: "Review" } });
  const form = screen.getByRole("button", { name: "Change plan" }).closest("form")!;
  fireEvent.submit(form);
  await waitFor(() => expect(within(form).getByRole("status").textContent).toMatch(/no change|unchanged|already/i));
});

it.each([
  ["plan", "Change plan", "Changing plan", "Plan changed", "No change to the plan"],
  ["trial", "Save deadline", "Saving deadline", "Trial deadline saved", "No change to the trial deadline"],
])("announces %s pending, change, no-op and refusal", async (kind, label, pendingText, successText, noopText) => {
  const action = kind === "plan" ? assign : deadline;
  let resolve!: (value: unknown) => void;
  action.mockImplementationOnce(() => new Promise((done) => { resolve = done; }))
    .mockResolvedValueOnce({ kind: "applied", changed: false })
    .mockResolvedValueOnce({ kind: "refused", message: "Permission refused." });
  render(<PlanCommercialControls tenantId="tenant" currentPlanId={null} currentPlanName={null} eligiblePlans={[{ key: "standard", name: "Standard" }]} currentTrialExpiresAt={null} canWrite />);
  const button = screen.getByRole("button", { name: label });
  const form = button.closest("form")!;
  fireEvent.submit(form);
  expect(within(form).getByRole("status").textContent).toContain(pendingText);
  expect(button.hasAttribute("disabled")).toBe(true);
  await act(async () => { resolve({ kind: "applied", changed: true }); });
  expect(within(form).getByRole("status").textContent).toContain(successText);
  fireEvent.submit(form);
  await waitFor(() => expect(within(form).getByRole("status").textContent).toContain(noopText));
  fireEvent.submit(form);
  await waitFor(() => expect(within(form).getByRole("alert").textContent).toContain("Permission refused."));
  expect(within(form).getByRole("status").textContent).not.toContain(successText);
});

it("does not render commercial write forms for viewers", () => {
  render(<PlanCommercialControls tenantId="tenant" currentPlanId={null} currentPlanName={null} eligiblePlans={[]} currentTrialExpiresAt={null} canWrite={false} />);
  expect(screen.queryByRole("button", { name: "Change plan" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Save deadline" })).toBeNull();
});
