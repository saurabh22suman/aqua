// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

const context = vi.hoisted(() => ({ canWrite: true, cookie: "22222222-2222-4222-8222-222222222222" }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: async () => ({ tenantId: "t", userId: "u" }), requirePagePermission: vi.fn() }));
vi.mock("@/lib/auth/permission", () => ({ hasPermission: () => context.canWrite }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: context.cookie }) }) }));
vi.mock("@/lib/actions/people", () => ({ listMembersAction: async () => [] }));
vi.mock("@/lib/actions/terminology", () => ({ getTerminologyAction: async () => ({ locale: "en", overrides: {} }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/owner/members", useSearchParams: () => new URLSearchParams() }));
import MembersPage from "@/app/(owner)/owner/members/page";

async function show(facility: string) {
  const page = await MembersPage({ searchParams: Promise.resolve({ facility }) });
  const child = page.props.children as ReactElement<Record<string, unknown>, (props: Record<string, unknown>) => Promise<ReactElement>>;
  render(await child.type(child.props));
}
afterEach(() => { cleanup(); context.canWrite = true; });

describe("member directory create entry", () => {
  it("renders one labelled create link carrying an explicit all-facilities scope over a stale cookie", async () => {
    await show("all");
    const link = screen.getByTestId("members-create-action");
    expect(link.textContent).toContain("Add member");
    expect(link.getAttribute("href")).toBe("/owner/members/new?facility=all");
    expect(screen.getAllByRole("link", { name: "Add member" })).toHaveLength(1);
    expect(within(link).getByText("Add member")).toBeTruthy();
  });
  it("retains the selected facility in the create destination", async () => {
    const site = "11111111-1111-4111-8111-111111111111";
    await show(site);
    expect(screen.getByTestId("members-create-action").getAttribute("href")).toBe(`/owner/members/new?facility=${site}`);
  });
  it("does not offer create or import without member write permission", async () => {
    context.canWrite = false;
    await show("all");
    expect(screen.queryByTestId("members-create-action")).toBeNull();
    expect(screen.queryByTestId("members-import-link")).toBeNull();
  });
});
