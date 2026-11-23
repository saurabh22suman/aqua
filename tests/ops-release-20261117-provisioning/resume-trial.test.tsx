// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ transition: vi.fn(), refresh: vi.fn(), convert: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/actions/platform-leads", () => ({
  transitionLeadAction: mocks.transition,
  convertLeadAction: mocks.convert,
  completeLeadAction: vi.fn(),
}));

import { LeadActions } from "@/app/(platform)/ops/leads/[leadId]/lead-actions";

const props = {
  businessName: "Example club",
  leadId: "lead-123",
  hasLinkedTenant: true,
  linkedTenantId: "tenant-123",
  defaultSlug: "club",
  defaultLocationName: "Main",
  defaultPreset: "swimming",
  presetOptions: [{ key: "swimming", name: "Swimming" }],
  canWrite: true,
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("resume a linked trial", () => {
  it.each(["lapsed", "qualified", "demo_booked"])("returns %s to trial without provisioning", async (status) => {
    mocks.transition.mockResolvedValue({ kind: "ok", leadId: props.leadId });
    const view = render(<LeadActions {...props} currentStatus={status} />);
    fireEvent.click(screen.getByRole("button", { name: "Resume trial" }));
    await waitFor(() => expect(mocks.transition).toHaveBeenCalledWith("lead-123", {
      status: "trial", trialTenantId: "tenant-123",
    }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled());
    expect(mocks.convert).not.toHaveBeenCalled();
    view.rerender(<LeadActions {...props} currentStatus="trial" />);
    expect(screen.getByRole("button", { name: "Mark business conversion complete" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Resume trial" })).toBeNull();
  });

  it.each([
    { status: "lapsed", canWrite: false, linkedTenantId: "tenant-123", hasLinkedTenant: true },
    { status: "lapsed", canWrite: true, linkedTenantId: null, hasLinkedTenant: false },
    { status: "converted", canWrite: true, linkedTenantId: "tenant-123", hasLinkedTenant: true },
    { status: "lost", canWrite: true, linkedTenantId: "tenant-123", hasLinkedTenant: true },
    { status: "trial", canWrite: true, linkedTenantId: "tenant-123", hasLinkedTenant: true },
  ])("does not expose resume for $status with these permissions and link", (state) => {
    render(<LeadActions {...props} {...state} currentStatus={state.status} />);
    expect(screen.queryByRole("button", { name: "Resume trial" })).toBeNull();
  });

  it("surfaces a refusal from the existing transition action", async () => {
    mocks.transition.mockResolvedValue({ kind: "error", message: "The linked tenant cannot be replaced." });
    render(<LeadActions {...props} currentStatus="lapsed" />);
    fireEvent.click(screen.getByRole("button", { name: "Resume trial" }));
    expect(await screen.findByText("The linked tenant cannot be replaced.")).toBeTruthy();
    expect(mocks.convert).not.toHaveBeenCalled();
  });
});
