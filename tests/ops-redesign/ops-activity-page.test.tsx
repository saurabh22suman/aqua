// @vitest-environment jsdom
//
// Ops redesign (28 October 2026) — the activity log's header.
//
// The backend answers with the TOTAL number of matching events, but
// the list it returns is the latest slice (the default is the newest
// hundred). A header that says only "118 events match the current
// filters" reads as though the operator is looking at 118 events —
// and they are not: they are looking at the newest twenty-four of a
// hundred and eighteen.
//
// The page must say which is which: "Showing latest 24 of 118 matching
// events". When the slice IS everything, the plain total is enough.
//
// No backend change and no pagination: the slice the backend returns is
// the slice the page shows.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/platform-auth", () => ({
  platformAuthStatusAction: async () => ({
    kind: "authenticated",
    userId: "u1",
    role: "admin",
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`unexpected redirect: ${path}`);
  },
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/ops/activity",
}));

const activityMock = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  total: 0,
}));

vi.mock("@/lib/actions/platform-activity", () => ({
  listPlatformActivityAction: async () => ({
    rows: activityMock.rows,
    total: activityMock.total,
  }),
  listKnownActionsAction: async () => ["tenant.activate"],
}));

vi.mock("@/db/platform-tenants", () => ({
  listAllTenantsForSelector: async () => [
    { id: "t1", name: "Aqua Worli", slug: "aqua-worli" },
  ],
}));

import PlatformActivityPage from "@/app/(platform)/ops/activity/page";

afterEach(() => {
  cleanup();
  activityMock.rows = [];
  activityMock.total = 0;
});

function eventRow(index: number) {
  return {
    id: `a${index}`,
    action: "tenant.activate",
    actorId: null,
    tenantId: "t1",
    tenantName: "Aqua Worli",
    tenantSlug: "aqua-worli",
    detail: {},
    createdAt: new Date("2026-09-15T02:00:00.000Z"),
  };
}

describe("Activity log — the header says what is on screen", () => {
  it("says how many of the matching events are shown when the list is a slice", async () => {
    activityMock.total = 118;
    activityMock.rows = Array.from({ length: 24 }, (_, i) => eventRow(i));

    render(await PlatformActivityPage({ searchParams: Promise.resolve({}) }));

    expect(
      screen.getByText(/Showing latest 24 of 118 matching events/i),
    ).toBeDefined();
  });

  it("says the plain total when the list is everything", async () => {
    activityMock.total = 12;
    activityMock.rows = Array.from({ length: 12 }, (_, i) => eventRow(i));

    render(await PlatformActivityPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText(/12 events in the trail/i)).toBeDefined();
    expect(screen.queryByText(/Showing latest/i)).toBeNull();
  });
});
