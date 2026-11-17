// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as { id: string; name: string }[],
  unrestricted: false,
}));
vi.mock("@/db/tenant", () => ({
  withTenant: async (_id: string, fn: (tx: unknown) => Promise<unknown>) => fn({
    select: () => ({ from: () => ({ where: () => ({ orderBy: async () => state.rows }) }) }),
  }),
}));
vi.mock("@/lib/services/location-access", () => ({
  resolveLocationAccess: async () => ({ unrestricted: state.unrestricted }),
  locationVisible: () => true,
}));

import { staffSiteContext } from "@/lib/services/staff-scope";
import { StaffClubContext } from "@/components/staff-ui/staff-club-context";

afterEach(cleanup);

it.each([
  [[], false, "No assigned clubs"],
  [[{ id: "1", name: "North" }, { id: "2", name: "South" }], true, "All clubs"],
  [[{ id: "1", name: "North" }, { id: "2", name: "South" }], false, "2 assigned clubs"],
  [[{ id: "1", name: "All facilities" }], false, "All facilities"],
] as const)("renders the actual scoped site label without rewriting a club name", async (rows, unrestricted, expected) => {
  state.rows = [...rows];
  state.unrestricted = unrestricted;
  const siteLabel = await staffSiteContext({ tenantId: "00000000-0000-4000-8000-000000000000" as never });
  expect(siteLabel).toBe(expected);
  render(<StaffClubContext clubName="Example Business" roleLabel="receptionist" siteLabel={siteLabel} />);
  expect(screen.getByLabelText("Business: Example Business")).toBeTruthy();
  expect(screen.getByText(new RegExp(expected))).toBeTruthy();
});
