// @vitest-environment jsdom
//
// Ops redesign (28 October 2026) — the status transition labels.
//
// The transitions were labelled by TARGET, not by WHERE the tenant is
// coming from: a tenant on TRIAL was offered "Reactivate", which is
// what you offer a SUSPENDED tenant. "Activate" is what a trial
// tenant needs; "Reactivate" means it was switched off.
//
// The labels are the operator's only cue about what a button will do,
// so each one names the action for the state the tenant is actually
// in.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

import { StatusTransitionControls } from "@/app/(platform)/ops/tenants/[tenantId]/status-transitions";

afterEach(cleanup);

function renderControls(status: "trial" | "active" | "suspended" | "churned") {
  return render(
    <StatusTransitionControls
      tenantId="11111111-1111-4111-8111-111111111111"
      currentStatus={status}
      canWrite
    />,
  );
}

describe("Status transitions — the label matches the state", () => {
  it("offers a trial tenant Activate, not Reactivate", () => {
    renderControls("trial");
    expect(screen.getByRole("button", { name: "Activate" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Reactivate" })).toBeNull();
  });

  it("offers a suspended tenant Reactivate", () => {
    renderControls("suspended");
    expect(screen.getByRole("button", { name: "Reactivate" })).toBeDefined();
  });

  it("offers an active tenant neither Activate nor Reactivate", () => {
    renderControls("active");
    expect(screen.queryByRole("button", { name: "Activate" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reactivate" })).toBeNull();
    expect(screen.getByRole("button", { name: "Suspend" })).toBeDefined();
  });
});
