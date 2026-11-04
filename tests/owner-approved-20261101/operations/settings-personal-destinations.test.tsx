// @vitest-environment jsdom
import { expect, it } from "vitest";
import { settingCategories } from "@/components/settings/settings-surfaces";
it("offers personal appearance and report preferences as navigable settings", () => {
 const items = settingCategories({ ladderEnabled: false, multiLocation: false, canReadBookings: false }).flatMap(c => c.items);
 const appearance = items.find(x => x.href === "/owner/settings/appearance");
 const reports = items.find(x => x.href === "/owner/settings/reports");
 expect(appearance?.label).toMatch(/theme & artwork/i);
 expect(reports?.label).toMatch(/report/i);
 expect(appearance?.detail).toMatch(/personal|your/i);
 expect(reports?.detail).toMatch(/personal|your/i);
});
