// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ cookie: "", allowed: true, push: vi.fn(), create: vi.fn(async () => ({ ok: true, memberId: "member-1" })) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: state.cookie }) }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push, refresh: vi.fn() }) }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: async () => ({}), requirePagePermission: (_ctx: unknown, permission: string) => { if (permission !== "members.write" || !state.allowed) throw new Error("forbidden"); } }));
vi.mock("@/lib/actions/people", () => ({
  listLocationsAction: async () => [
    { id: "11111111-1111-4111-8111-111111111111", name: "Main" },
    { id: "22222222-2222-4222-8222-222222222222", name: "North" },
  ],
  createMemberAction: state.create, searchPersonsAction: vi.fn(async () => []),
}));
vi.mock("@/lib/actions/terminology", () => ({ getTerminologyAction: async () => ({ locale: "en", overrides: {} }) }));
import NewMemberPage from "@/app/(owner)/owner/members/new/page";
import { MemberCreateForm } from "@/components/member-create-form";

afterEach(() => { cleanup(); state.cookie = ""; state.allowed = true; state.push.mockClear(); state.create.mockClear(); });

it("uses facility vocabulary while requiring an explicit permitted choice", () => {
  render(<MemberCreateForm locations={[{ id: "allowed", name: "Main" }]} initialLocationId="" terminology={{ locale: "en", overrides: { facility: { en: { one: "lane", other: "lanes" } } } }} />);
  expect(screen.getByText(/selected lane is unavailable\. choose an available lane to continue/i)).toBeTruthy();
  expect((screen.getByLabelText("Location") as HTMLSelectElement).value).toBe("");
  expect(state.create).not.toHaveBeenCalled();
});

it("retains the members.write page guard", async () => {
  state.allowed = false;
  await expect(NewMemberPage({})).rejects.toThrow("forbidden");
});

it("starts at the selected permitted facility without marking an untouched draft dirty", async () => {
  state.cookie = "11111111-1111-4111-8111-111111111111";
  render(await NewMemberPage({ searchParams: Promise.resolve({ facility: "22222222-2222-4222-8222-222222222222" }) }));
  expect((screen.getByLabelText("Location") as HTMLSelectElement).value).toBe("22222222-2222-4222-8222-222222222222");
  expect(screen.getByRole("link", { name: /members/i }).getAttribute("href")).toContain("facility=22222222-2222-4222-8222-222222222222");
  expect(screen.getByRole("link", { name: "Cancel" }).getAttribute("href")).toContain("facility=22222222-2222-4222-8222-222222222222");
  fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
  expect(screen.queryByRole("dialog", { name: /discard changes/i })).toBeNull();
});

it("uses the permitted cookie choice when the URL has no facility", async () => {
  state.cookie = "22222222-2222-4222-8222-222222222222";
  render(await NewMemberPage({}));
  expect((screen.getByLabelText("Location") as HTMLSelectElement).value).toBe(state.cookie);
});

it("requires a deliberate permitted choice when an explicit facility is unavailable", async () => {
  state.cookie = "22222222-2222-4222-8222-222222222222";
  render(await NewMemberPage({ searchParams: Promise.resolve({ facility: "33333333-3333-4333-8333-333333333333" }) }));
  const location = screen.getByLabelText("Location") as HTMLSelectElement;
  expect(location.value).toBe("");
  expect(screen.getByText(/selected facility is unavailable/i)).toBeTruthy();
  expect(screen.getByRole("link", { name: /members/i }).getAttribute("href")).toBe("/owner/members");
  fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
  expect(screen.queryByRole("dialog", { name: /discard changes/i })).toBeNull();
  fireEvent.change(location, { target: { value: "11111111-1111-4111-8111-111111111111" } });
  fireEvent.click(screen.getByRole("link", { name: "Cancel" }));
  expect(screen.getByRole("dialog", { name: /discard changes/i })).toBeTruthy();
});

it("cannot submit without a deliberate location, and submits the chosen allowed location", async () => {
  render(await NewMemberPage({ searchParams: Promise.resolve({ facility: "33333333-3333-4333-8333-333333333333" }) }));
  fireEvent.change(screen.getByTestId("member-full-name"), { target: { value: "Test Person" } });
  fireEvent.change(screen.getByTestId("member-dob"), { target: { value: "01/01/1990" } });
  screen.getByTestId("member-dob").scrollIntoView = vi.fn();
  fireEvent.click(screen.getByTestId("consent-checkbox"));
  fireEvent.click(screen.getByTestId("submit-member"));
  expect(screen.getByRole("alert").textContent).toMatch(/location are required/i);
  expect(state.create).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Location"), { target: { value: "11111111-1111-4111-8111-111111111111" } });
  fireEvent.click(screen.getByTestId("submit-member"));
  await waitFor(() => expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ locationId: "11111111-1111-4111-8111-111111111111" })));
});

it("keeps the first permitted default for an explicit all-facilities scope", async () => {
  state.cookie = "22222222-2222-4222-8222-222222222222";
  render(await NewMemberPage({ searchParams: Promise.resolve({ facility: "all" }) }));
  expect((screen.getByLabelText("Location") as HTMLSelectElement).value).toBe("11111111-1111-4111-8111-111111111111");
});

it("keeps the first permitted default when no facility is selected", async () => {
  render(await NewMemberPage({}));
  expect((screen.getByLabelText("Location") as HTMLSelectElement).value).toBe("11111111-1111-4111-8111-111111111111");
});
