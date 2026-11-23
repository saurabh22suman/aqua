import { expect, it } from "vitest";
import { CONFIG_KEYS } from "@/db/config-definitions";
it("describes explicit club assignments as independent of the legacy default", () => {
  const description = CONFIG_KEYS["access.location_scoped_staff"].description;
  expect(description).toMatch(/legacy default/i);
  expect(description).toMatch(/explicit.*always.*(club|location)/i);
});
