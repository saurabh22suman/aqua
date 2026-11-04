import { describe, expect, it } from "vitest";
import { ownerSidebarGroupsForPermissions } from "@/lib/nav";

describe("approved owner navigation", () => {
  it("does not expose restricted desktop destinations through grouped navigation", () => {
    const items = ownerSidebarGroupsForPermissions(new Set()).flatMap((group) => group.items);
    expect(items.some((item) => item.href === "/owner/fees" || item.href === "/owner/schedule" || item.href === "/owner/settings")).toBe(false);
  });
});
