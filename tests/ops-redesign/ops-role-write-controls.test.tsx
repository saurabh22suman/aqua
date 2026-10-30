// @vitest-environment jsdom
//
// Ops redesign (28 October 2026) — the role reaches the mutating UI.
//
// The server already refuses a viewer's write: every platform mutation
// calls the admin gate, and db/ops-action.ts re-checks the actor row
// inside the transaction. That is the ENFORCEMENT and it does not move.
//
// What this file pins is the other half: the CONSOLE must not hand a
// viewer a control that cannot work. A viewer sees the state and the
// reason it cannot change it — never a live-looking button that
// silently fails on submit.
//
// The role is resolved on the SERVER (platformAuthStatusAction) and
// passed into the client islands as a plain boolean. It is never read
// from a client field, and it never decides an authorization.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  role: "admin" as string,
}));

vi.mock("@/lib/actions/platform-auth", () => ({
  platformAuthStatusAction: async () => ({
    kind: "authenticated",
    userId: "u1",
    role: auth.role,
  }),
}));

// The tenant pages resolve their reads through the approved Ops operation
// boundary. These suites assert the page contract, not the audit path, so the
// boundary delegates to the read it is given. Fixture-only: no assertion,
// product branch or source behaviour changes.
vi.mock("@/lib/auth/ops-operation", () => ({
  runOpsRead: async (
    _operation: string,
    _tenantId: string,
    read: () => Promise<unknown>,
  ) => read(),
  runOpsGlobalRead: async (
    _operation: string,
    read: () => Promise<unknown>,
  ) => read(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  redirect: (path: string) => {
    throw new Error(`unexpected redirect: ${path}`);
  },
  notFound: () => {
    throw new Error("unexpected notFound");
  },
}));

vi.mock("@/lib/params", () => ({ requireUuidParam: () => undefined }));

const TENANT_ID = "11111111-1111-1111-1111-111111111111";

vi.mock("@/db/platform-tenants", () => ({
  getTenantDetail: async () => ({
    id: TENANT_ID,
    name: "Aqua Worli",
    slug: "aqua-worli",
    status: "trial",
    timezone: "Asia/Kolkata",
    currency: "INR",
    gstin: null,
    planName: "Standard",
    planId: null,
    presetKey: null,
    presetVersion: null,
    offlineSyncEnabled: false,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    memberCount: 0,
    locationCount: 1,
    sessionsThisMonth: 0,
    locations: [],
    featureKeys: [],
    recentActivity: [],
  }),
}));
vi.mock("@/db/sample-data-state", () => ({
  getSampleDataState: async () => ({ hasSample: false, hasReal: false }),
}));

// The islands are replaced with probes that report the `canWrite` flag
// the page handed them, so the assertion is about the WIRING: the
// server-resolved role has to arrive at the mutating UI.
vi.mock(
  "@/app/(platform)/ops/tenants/[tenantId]/status-transitions",
  () => ({
    StatusTransitionControls: (props: { canWrite?: boolean }) => (
      <div data-testid="status-controls" data-can-write={String(props.canWrite)} />
    ),
  }),
);
vi.mock(
  "@/app/(platform)/ops/tenants/[tenantId]/invite-owner-form",
  () => ({
    InviteOwnerForm: (props: { canWrite?: boolean }) => (
      <div data-testid="invite-owner-form" data-can-write={String(props.canWrite)} />
    ),
  }),
);
vi.mock(
  "@/app/(platform)/ops/tenants/[tenantId]/remove-sample-data-button",
  () => ({
    RemoveSampleDataButton: (props: { canWrite?: boolean }) => (
      <div data-testid="remove-sample" data-can-write={String(props.canWrite)} />
    ),
  }),
);

import PlatformTenantDetailPage from "@/app/(platform)/ops/tenants/[tenantId]/page";

afterEach(() => {
  cleanup();
  auth.role = "admin";
});

describe("Ops tenant overview — the role reaches the mutating UI", () => {
  it("hands the mutating islands the write permission for an admin", async () => {
    auth.role = "admin";
    render(
      await PlatformTenantDetailPage({
        params: Promise.resolve({ tenantId: TENANT_ID }),
      }),
    );

    expect(screen.getByTestId("status-controls").dataset.canWrite).toBe("true");
    expect(screen.getByTestId("invite-owner-form").dataset.canWrite).toBe("true");
  });

  it("denies the write permission to a viewer", async () => {
    auth.role = "viewer";
    render(
      await PlatformTenantDetailPage({
        params: Promise.resolve({ tenantId: TENANT_ID }),
      }),
    );

    expect(screen.getByTestId("status-controls").dataset.canWrite).toBe("false");
    expect(screen.getByTestId("invite-owner-form").dataset.canWrite).toBe("false");
  });
});
