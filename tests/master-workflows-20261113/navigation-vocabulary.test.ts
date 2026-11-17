import { expect, it } from "vitest";
import { navForRole, ownerNavForPermissions, ownerSidebarGroupsForPermissions } from "@/lib/nav";
import type { TerminologyState } from "@/lib/terminology/keys";
import { ownerSidebarGroupsWithBookings } from "@/components/owner-ui/owner-navigation";

it("uses stable Owner vocabulary without changing permission filtering or Coach overrides", () => {
  const terminology:TerminologyState = {locale:"en",overrides:{member:{en:{one:"player",other:"players"}}}};
  const granted = new Set(["members.read"]);
  expect(ownerNavForPermissions(granted, terminology).find(item => item.href === "/owner/members")?.label).toBe("Members");
  expect(ownerSidebarGroupsForPermissions(granted, terminology).flatMap(group => group.items).find(item => item.href === "/owner/members")?.label).toBe("Members");
  expect(ownerNavForPermissions(new Set(), terminology).some(item => item.href === "/owner/members")).toBe(false);
  expect(navForRole("coach", terminology).find(item => item.href === "/coach/members")?.label).toBe("Players");
  expect(ownerNavForPermissions(granted).find(item => item.href === "/owner/members")?.label).toBe("Members");
});
it("requires a booking grant and either existing booking capability for the booking link", () => {
  const visible = (permissions:string[], features:string[]) => ownerSidebarGroupsWithBookings([],new Set(permissions),new Set(features)).some(group => group.items.some(item => item.href === "/owner/bookings"));
  expect(visible(["bookings.read"],["court.booking"])).toBe(true);
  expect(visible(["bookings.read"],["pool.booking"])).toBe(true);
  expect(visible(["bookings.read"],[])).toBe(false);
  expect(visible([],["court.booking"])).toBe(false);
});
it.each([
  ["en", "Very long academy participant designation", "Members"],
  ["hi", "बहुत लंबे नाम वाले खिलाड़ी", "सदस्य"],
  ["bn", "দীর্ঘ নামের খেলোয়াড়গণ", "সদস্য"],
] as const)("keeps canonical Owner %s vocabulary and preserves complete non-Owner overrides", (locale, label, ownerLabel) => {
  const terminology:TerminologyState = {locale,overrides:{member:{[locale]:{one:label,other:label}}}};
  const items = ownerNavForPermissions(new Set(["members.read","reports.operational"]),terminology);
  expect(items.find(item => item.href === "/owner/members")?.label).toBe(ownerLabel);
  expect(navForRole("coach",terminology).find(item => item.href === "/coach/members")?.label).toBe(label);
  expect(items.find(item => item.href === "/owner/reports")?.label).toBe("Reports");
});
