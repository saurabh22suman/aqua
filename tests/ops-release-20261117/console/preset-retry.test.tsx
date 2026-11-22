// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/platform-preset-apply", () => ({ applyPresetAction: vi.fn() }));
import { PresetDetailForm } from "@/app/(platform)/ops/presets/[key]/preset-detail-form";

afterEach(cleanup);
const tenants = [{ id: "tenant", name: "Business", slug: "business", status: "active", presetKey: "swim", presetVersion: 1 }];
function show(bound: string) {
  render(<PresetDetailForm presetKey="swim" presetName="Swimming" tenants={tenants} locationsByTenant={{ tenant: [{ id: "club", name: "Club", kind: "pool", isPrimary: true, presetKey: bound, presetVersion: 1, eligible: true }] }} />);
}
it("explains that retrying the same preset is a no-op", () => {
  show("swim");
  expect(screen.getByText(/already applied.*no changes/i)).toBeDefined();
  expect(screen.queryByText(/engine will refuse/i)).toBeNull();
});
it("explains that a different preset is locked", () => {
  show("tennis");
  expect(screen.getByText(/switching presets requires manual/i)).toBeDefined();
});
