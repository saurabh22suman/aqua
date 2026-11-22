import { expect, it } from "vitest";
import { CONFIG_KEYS } from "@/db/config-definitions";
it("identifies the unused offline registry setting instead of describing it as the active kill switch", () => {
  expect(CONFIG_KEYS["attendance.offline_sync_enabled"].description).toMatch(/not.*(runtime|used)/i);
});
