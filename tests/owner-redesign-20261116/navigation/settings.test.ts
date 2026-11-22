import { expect, it } from "vitest";
import { settingCategories } from "@/components/settings/settings-surfaces";

it("separates personal preferences from club administration and keeps optional vocabulary", () => {
  const categories = settingCategories({ ladderEnabled: false, multiLocation: true, canReadBookings: false });
  const containing = (href: string) => categories.find(category => category.items.some(item => item.href === href));
  expect(containing("/owner/settings/appearance")?.label).toBe("Personal preferences");
  expect(containing("/owner/settings/branding")?.label).toBe("Business account");
  expect(containing("/owner/settings/terminology")?.items.find(item => item.href.endsWith("terminology"))?.detail).toMatch(/optional/i);
  expect(containing("/owner/bookings")).toBeUndefined();
});
