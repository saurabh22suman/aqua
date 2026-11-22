import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
const state = vi.hoisted(() => ({ allowed: true }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
vi.mock("@/lib/auth/self-scope", () => ({ resolveScopedSelfScope: async () => ({ read: async (fn: (tx: object, scope: object) => unknown) => fn({}, {}) }) }));
vi.mock("@/lib/services/self-home", () => ({ readSelfHome: async () => ({ clubName: "Club", audience: "guardian", entries: [
  { memberId: "11111111-1111-4111-8111-111111111111", fullName: "Aarav Example", memberCode: "AAA001" },
  { memberId: "22222222-2222-4222-8222-222222222222", fullName: "Anika Example", memberCode: "BBB002" },
] }) }));
vi.mock("@/lib/services/self-billing", () => ({ readSelfBilling: async () => state.allowed ? { outstanding: [], payments: [] } : null }));
vi.mock("@/lib/services/showcase/state", () => ({ readShowcaseState: async () => ({ subjects: state.allowed ? [
  { memberId: "11111111-1111-4111-8111-111111111111", allowedActions: [], chosenName: null, reason: "Private", publicPath: null },
  { memberId: "22222222-2222-4222-8222-222222222222", allowedActions: [], chosenName: null, reason: "Private", publicPath: null },
] : [] }) }));
import FamilyBillingPage from "@/app/(self)/family/billing/[memberId]/page";
import FamilyShowcasePage from "@/app/(self)/family/showcase/[memberId]/page";

it.each(ids.map((id, i) => [id, ["Aarav Example", "Anika Example"][i]]))("identifies child %s in billing", async (memberId, name) => {
  state.allowed = true;
  const params = Promise.resolve({ memberId });
  expect(renderToStaticMarkup(await FamilyBillingPage({ params }))).toContain(name);
});

it.each([[ids[0], "AAA001"], [ids[1], "BBB002"]])("keeps a distinct membership code for child %s on billing", async (memberId, code) => {
  state.allowed = true;
  expect(renderToStaticMarkup(await FamilyBillingPage({ params: Promise.resolve({ memberId }) }))).toContain(code);
});
it.each([[ids[0], "AAA001"], [ids[1], "BBB002"]])("keeps a distinct membership code for child %s on showcase", async (memberId, code) => {
  state.allowed = true;
  expect(renderToStaticMarkup(await FamilyShowcasePage({ params: Promise.resolve({ memberId }), searchParams: Promise.resolve({}) }))).toContain(code);
});
it.each(ids.map((id, i) => [id, ["Aarav Example", "Anika Example"][i]]))("identifies child %s in showcase", async (memberId, name) => {
  state.allowed = true;
  const params = Promise.resolve({ memberId });
  expect(renderToStaticMarkup(await FamilyShowcasePage({ params, searchParams: Promise.resolve({}) }))).toContain(name);
});

it("denies a child not authorised for the requested data", async () => {
  state.allowed = false;
  await expect(FamilyBillingPage({ params: Promise.resolve({ memberId: ids[0] }) })).rejects.toThrow("NOT_FOUND");
  await expect(FamilyShowcasePage({ params: Promise.resolve({ memberId: ids[0] }), searchParams: Promise.resolve({}) })).rejects.toThrow("NOT_FOUND");
});
