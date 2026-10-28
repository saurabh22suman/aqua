// @vitest-environment jsdom
//
// Ops redesign (28 October 2026) — every WRITE screen is read-only for
// a viewer.
//
// The server already refuses a viewer's mutation: that is the
// ENFORCEMENT and it does not move. This is the console's half — a
// viewer must not be handed a live-looking control that silently
// fails on submit.
//
// Three destinations were still handing a viewer a live form:
//
//   - /ops/tenants/new  — the create-tenant form
//   - /ops/leads/new     — the create-lead form
//   - /ops/whatsapp      — the mock message island (send / inject)
//
// The role is resolved on the SERVER (platformAuthStatusAction) and
// handed to the island as a plain boolean. It is never read from a
// client field, and it never decides an authorization.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  value: { kind: "authenticated", role: "admin" } as { kind: string; role?: string },
}));

vi.mock("@/lib/actions/platform-auth", () => ({
  platformAuthStatusAction: async () => authState.value,
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`unexpected redirect: ${path}`);
  },
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

vi.mock("@/db/platform-tenant-create", () => ({
  listActivePlans: async () => [
    { key: "starter", name: "Starter", isDefault: true },
  ],
}));
vi.mock("@/db/platform-presets", () => ({
  listPresets: async () => [
    { key: "multi-sport", version: 1, name: "Multi-sport", description: "", status: "active" },
  ],
}));
vi.mock("@/db/platform-messages", () => ({
  listRecentMessages: async () => [],
}));
vi.mock("@/db/platform-tenants", () => ({
  listTenants: async () => ({ total: 0, rows: [] }),
}));
vi.mock("@/lib/messaging/provider", () => ({
  mockMessagingEnabled: () => true,
}));

import NewTenantPage from "@/app/(platform)/ops/tenants/new/page";
import NewLeadPage from "@/app/(platform)/ops/leads/new/page";
import WhatsAppMockPage from "@/app/(platform)/ops/whatsapp/page";

afterEach(() => {
  cleanup();
  authState.value = { kind: "authenticated", role: "admin" };
});

describe("Write screens — a viewer is read-only", () => {
  it("the new-tenant form is not offered to a viewer", async () => {
    authState.value = { kind: "authenticated", role: "viewer" };
    render(await NewTenantPage());

    expect(screen.queryByRole("button", { name: /create tenant/i })).toBeNull();
    expect(screen.queryByLabelText(/club name/i)).toBeNull();
    expect(screen.getByTestId("ops-read-only-note")).toBeDefined();
  });

  it("the new-tenant form is offered to an admin", async () => {
    authState.value = { kind: "authenticated", role: "admin" };
    render(await NewTenantPage());

    expect(screen.getByRole("button", { name: /create tenant/i })).toBeDefined();
  });

  it("the new-lead form is not offered to a viewer", async () => {
    authState.value = { kind: "authenticated", role: "viewer" };
    render(await NewLeadPage());

    expect(screen.queryByRole("button", { name: /save lead/i })).toBeNull();
    expect(screen.queryByLabelText(/business name/i)).toBeNull();
    expect(screen.getByTestId("ops-read-only-note")).toBeDefined();
  });

  it("the new-lead form is offered to an admin", async () => {
    authState.value = { kind: "authenticated", role: "admin" };
    render(await NewLeadPage());

    expect(screen.getByRole("button", { name: /save lead/i })).toBeDefined();
  });

  it("the WhatsApp mock's send and inject controls are not offered to a viewer", async () => {
    authState.value = { kind: "authenticated", role: "viewer" };
    render(await WhatsAppMockPage());

    expect(
      screen.queryByRole("button", { name: /send mock message/i }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: /inject inbound/i })).toBeNull();
    expect(screen.getByTestId("ops-read-only-note")).toBeDefined();
  });

  it("the WhatsApp mock's controls are offered to an admin", async () => {
    authState.value = { kind: "authenticated", role: "admin" };
    render(await WhatsAppMockPage());

    expect(screen.getByRole("button", { name: /send mock message/i })).toBeDefined();
    expect(screen.getByRole("button", { name: /inject inbound/i })).toBeDefined();
  });
});
