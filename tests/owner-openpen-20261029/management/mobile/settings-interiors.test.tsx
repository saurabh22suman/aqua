// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner OpenPen management lane (29 October 2026) — Settings interiors.
//
// The reference puts the EXISTING catalogue first and keeps creation
// behind one contextual disclosure: existing activities/holidays, the
// café catalogue, and the plan catalogue each lead; "Add …" opens the
// bounded editor. Phone records stay identity-first.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

vi.mock("@/lib/actions/activities", () => ({
  createActivityAction: async () => ({ ok: true, id: "a2" }),
  updateActivityAction: async () => ({ ok: true, id: "a1" }),
  deleteActivityAction: async () => ({ ok: true, id: "a1" }),
  addSubUnitAction: async () => ({ ok: true }),
  removeSubUnitAction: async () => ({ ok: true }),
}));
vi.mock("@/lib/actions/holidays", () => ({
  addHolidayAction: async () => ({ kind: "ok" }),
  removeHolidayAction: async () => ({ kind: "ok" }),
}));
vi.mock("@/lib/actions/menu", () => ({
  createMenuCategoryAction: async () => ({ ok: true }),
  updateMenuCategoryAction: async () => ({ ok: true }),
  archiveMenuCategoryAction: async () => ({ ok: true }),
  createMenuItemAction: async () => ({ ok: true }),
  updateMenuItemAction: async () => ({ ok: true }),
  archiveMenuItemAction: async () => ({ ok: true }),
}));
vi.mock("@/lib/actions/membership-plans", () => ({
  activatePlanFromShapeAction: async () => ({ ok: true, id: "p2" }),
  createPlanAction: async () => ({ ok: true, id: "p2" }),
  updatePlanAction: async () => ({ ok: true, id: "p1" }),
  archivePlanAction: async () => ({ ok: true, id: "p1" }),
}));

import { ActivityManager } from "@/components/activity-manager";
import { HolidaysBoard } from "@/components/holidays-board";
import { MenuManager } from "@/components/menu-manager";
import { PlanManager } from "@/components/plan-manager";

afterEach(cleanup);

const LOCATIONS = [{ id: "loc-1", name: "Worli Main", isPrimary: true }];

describe("settings interiors put the catalogue first", () => {
  it("lists existing activities before the add editor", () => {
    const { container } = render(
      <ActivityManager
        locations={LOCATIONS}
        activities={[
          {
            id: "act-1",
            locationId: "loc-1",
            locationName: "Worli Main",
            name: "Main pool",
            kind: "pool",
            capacity: 16,
            isSample: false,
            subUnits: [],
            createdAt: "2026-10-01T04:00:00.000Z",
          },
        ]}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 2, name: "Existing activities" }),
    ).toBeTruthy();
    const text = container.textContent ?? "";
    expect(text.indexOf("Main pool")).toBeLessThan(text.indexOf("Add activity"));
  });

  it("lists holidays before the add editor", () => {
    const { container } = render(
      <HolidaysBoard
        initialHolidays={[
          {
            id: "hol-1",
            name: "Founder's Day",
            holidayDate: "2026-10-24",
            recurringYearly: false,
          },
        ]}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 2, name: "Holiday list" }),
    ).toBeTruthy();
    const text = container.textContent ?? "";
    expect(text.indexOf("Founder's Day")).toBeLessThan(
      text.indexOf("Add holiday"),
    );
  });

  it("lists the café catalogue before adding a category", () => {
    const { container } = render(
      <MenuManager
        categories={[
          {
            id: "cat-1",
            locationId: "loc-1",
            name: "Beverages",
            sortOrder: 0,
            isActive: true,
          },
        ]}
        items={[
          {
            id: "item-1",
            locationId: "loc-1",
            categoryId: "cat-1",
            name: "Masala chai",
            pricePaise: 25000,
            taxRateBp: 500,
            sacCode: "996331",
            isVeg: true,
            isActive: true,
          },
        ]}
        locations={LOCATIONS}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 2, name: "Menu catalogue" }),
    ).toBeTruthy();
    const text = container.textContent ?? "";
    expect(text.indexOf("Masala chai")).toBeLessThan(
      text.indexOf("Add category"),
    );
  });

  it("lists the plan catalogue before creating a plan", () => {
    const { container } = render(
      <PlanManager
        templates={[]}
        plans={[
          {
            id: "plan-1",
            name: "Monthly Swim",
            kind: "duration",
            durationDays: 30,
            sessions: null,
            amountPaise: 280000,
            locationId: "loc-1",
            locationName: "Worli Main",
            activityId: null,
            activityName: null,
            isActive: true,
            sourceShapeId: null,
            createdAt: "2026-10-01T04:00:00.000Z",
          },
        ]}
        locations={LOCATIONS}
        activities={[]}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 2, name: "Plans catalogue" }),
    ).toBeTruthy();
    const text = container.textContent ?? "";
    expect(text.indexOf("Monthly Swim")).toBeLessThan(
      text.indexOf("Add a plan"),
    );
  });
});
