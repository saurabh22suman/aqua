// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

// Owner-UI review P2 (2026-10-13) — import is a members.write surface.
// A tenant-edited role with members.read but without members.write must
// not receive the import form; the page gate matches the action gate.

const notFound = vi.hoisted(() =>
  vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
);
const ctxRef = vi.hoisted(() => ({ value: { permissions: new Set<string>() } }));
vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ctxRef.value,
  requirePagePermission: (ctx: { permissions: Set<string> }, key: string) => {
    if (!ctx.permissions.has(key)) notFound();
    return ctx;
  },
}));
vi.mock("@/lib/actions/member-import", () => ({
  previewMemberImportAction: vi.fn(),
  commitMemberImportAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  notFound,
}));

import MemberImportPage from "@/app/(owner)/owner/members/import/page";

describe("member import page guard (P2)", () => {
  it("404s for a caller with members.read but no members.write", async () => {
    ctxRef.value = { permissions: new Set(["members.read"]) };
    await expect(MemberImportPage()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders for a members.write holder", async () => {
    ctxRef.value = { permissions: new Set(["members.write"]) };
    await expect(MemberImportPage()).resolves.toBeTruthy();
  });
});
