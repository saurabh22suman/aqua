import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("lead intake provisioning explanation", () => {
  it.each([
    "app/(platform)/ops/leads/page.tsx",
    "app/(platform)/ops/leads/new/new-lead-form.tsx",
  ])("distinguishes applied and recorded answers in %s", (path) => {
    const copy = readFileSync(path, "utf8").toLowerCase();
    expect(copy).toMatch(/sport/);
    expect(copy).toMatch(/location/);
    expect(copy).toMatch(/fee/);
    expect(copy).toMatch(/gst/);
    expect(copy).toMatch(/collection/);
    expect(copy).toMatch(/coach/);
    expect(copy).toMatch(/recorded/);
    expect(copy).not.toMatch(/nothing is re-entered|seed its\s+configuration/);
  });
});
