import { describe, expect, it } from "vitest";
import { navForRole, ownerNavForPermissions, ownerSidebarGroupsForPermissions } from "@/lib/nav";
import type { TerminologyState } from "@/lib/terminology/keys";

const swimming: TerminologyState = {
  locale: "en",
  overrides: { member: { en: { one: "swimmer", other: "swimmers" } } },
};

describe("owner navigation vocabulary", () => {
  it("uses Members in both owner navigations while preserving coach vocabulary", () => {
    const permissions = new Set(["members.read"]);
    expect(ownerNavForPermissions(permissions, swimming).find(x => x.href === "/owner/members")?.label).toBe("Members");
    expect(ownerSidebarGroupsForPermissions(permissions, swimming).flatMap(x => x.items).find(x => x.href === "/owner/members")?.label).toBe("Members");
    expect(navForRole("owner", swimming).find(x => x.href === "/owner/members")?.label).toBe("Members");
    expect(navForRole("coach", swimming).find(x => x.href === "/coach/members")?.label).toBe("Swimmers");
  });
});
