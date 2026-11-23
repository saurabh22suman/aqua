import { describe, expect, it } from "vitest";
import { ownerSidebarGroupsForPermissions } from "@/lib/nav";

function destinations(grants: string[], messaging: boolean) {
  return ownerSidebarGroupsForPermissions(
    new Set(grants),
    undefined,
    new Set(messaging ? ["messaging"] : []),
  ).flatMap((group) => group.items);
}

describe("one entry per Owner task", () => {
  it("makes the Schedule destination active on both calendar and list", () => {
    const items = destinations(["attendance.read", "programs.write"], true);
    expect(items.filter((item) => ["/owner/schedule", "/owner/sessions"].includes(item.href)))
      .toEqual([expect.objectContaining({ href: "/owner/schedule", label: "Schedule", activePrefixes: ["/owner/sessions"] })]);
  });

  it("keeps the session list reachable for a role without calendar access", () => {
    const items = destinations(["programs.write"], true);
    expect(items.find((item) => item.label === "Schedule")?.href).toBe("/owner/sessions");
  });

  it.each([
    { grants: ["messaging.send", "members.read"], messaging: true, href: "/owner/announcements" },
    { grants: ["messaging.send", "members.read"], messaging: false, href: "/owner/inbox" },
    { grants: ["members.read"], messaging: true, href: "/owner/inbox" },
  ])("offers one correct Announcements entry when messaging is $messaging and the role has $grants", ({ grants, messaging, href }) => {
    const items = destinations(grants, messaging);
    expect(items.filter((item) => ["/owner/announcements", "/owner/inbox"].includes(item.href)))
      .toEqual([expect.objectContaining({ href, label: "Announcements" })]);
  });
});
