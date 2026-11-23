import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const subject = {
  memberId: "11111111-1111-4111-8111-111111111111",
  role: "subject",
  isMinor: false,
  state: "private",
  reason: "Not published",
  chosenName: null,
  allowedActions: ["approve", "revoke"],
  publicPath: null,
  lastSubjectAction: null,
};
vi.mock("@/lib/auth/self-scope", () => ({ resolveScopedSelfScope: async () => ({ read: async (fn: (tx: object, scope: object) => unknown) => fn({}, {}) }) }));
vi.mock("@/lib/services/showcase/state", () => ({ readShowcaseState: async () => ({ subjects: [subject] }) }));
vi.mock("@/lib/services/self-home", () => ({ readSelfHome: async () => ({ entries: [{ memberId: subject.memberId, fullName: "Example child" }] }) }));
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); } }));
import MemberShowcasePage from "@/app/(self)/member/showcase/page";
import FamilyShowcasePage from "@/app/(self)/family/showcase/[memberId]/page";

describe("public name decision disclosure", () => {
  it("explains the fixed name before a member first submits it", async () => {
    const html = renderToStaticMarkup(await MemberShowcasePage({ searchParams: Promise.resolve({}) }));
    expect(html).toMatch(/name.{0,100}(cannot|can.t|cannot be).{0,40}(chang|edit)/i);
    expect(html).toMatch(/(private|take.{0,10}down|withdraw)/i);
  });

  it("explains the fixed name before a guardian first approves it", async () => {
    const html = renderToStaticMarkup(await FamilyShowcasePage({ params: Promise.resolve({ memberId: subject.memberId }), searchParams: Promise.resolve({}) }));
    expect(html).toMatch(/name.{0,100}(cannot|can.t|cannot be).{0,40}(chang|edit)/i);
    expect(html).toMatch(/child.{0,100}(choice|decision)/i);
  });
});
