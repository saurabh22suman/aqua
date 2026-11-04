// @vitest-environment jsdom
//
// Finance lane — intended RED (3 November 2026): several Owner Settings
// pages spend a line of visible prose repeating either the task that is
// already on screen or the internal architecture behind it.
//
// The coordinator's named pages: Settings main, locations, skills, plans,
// menu, branding, holidays and the vocabulary route. The rule is narrow —
// shorten ONLY what repeats the visible task or describes internal
// architecture. Everything that carries a scope, a read-only indicator, a
// validation/safety/tax/consent message or a consequence stays.
//
// What must disappear:
//   * "Choose the task you need to complete."   (Settings main)
//   * "generic framework … the preset's own ladder stays as seeded"
//                                               (skill ladder)
//   * "A second site turns on the location concept across Aqua"
//                                               (location manager)
//   * "Database columns and exports stay canonical"
//                                               (vocabulary)
//   * "a national holiday won't leave a coach with an empty register"
//                                               (holidays — repeats the
//                                                board's own empty state)
//
// What must survive (controls — these are green today and must stay green):
//   * the café menu keeps its tax facts (GST rate, SAC code) exactly once
//     and the reception read-only scope;
//   * the vocabulary route keeps its read-only locale indicator;
//   * the single-site scope note survives;
//   * the holidays page keeps exactly ONE statement that sessions which
//     were already generated are NOT cancelled.
//
// Every page here is rendered for real; the heavy child editors are stubbed
// because this test is about the page's own visible copy.

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    tenantId: "tenant-a",
    userId: "user-a",
    permissions: new Set(["settings.manage"]),
    features: new Set(["swim.levels"]),
  }),
  requirePagePermission: () => undefined,
}));
vi.mock("@/lib/services/staff", () => ({
  getCurrentStaffIdentity: async () => ({
    fullName: "Owner Ojaswi",
    phone: "+919000000001",
  }),
}));
vi.mock("@/lib/actions/locations", () => ({
  listAdminLocationsAction: async () => [{ id: "loc-1", name: "Worli Main" }],
  createLocationAction: vi.fn(),
  updateLocationAction: vi.fn(),
}));
vi.mock("@/lib/actions/onboarding-checklist", () => ({
  getOnboardingChecklistAction: async () => ({
    items: [{ key: "add_members", complete: true }],
    completedCount: 1,
    totalCount: 1,
  }),
}));
vi.mock("@/components/tenant-sign-out", () => ({
  TenantSignOut: () => <div data-testid="tenant-sign-out" />,
}));
vi.mock("@/lib/actions/skill-ladder", () => ({
  listSkillLaddersAction: async () => [],
}));
vi.mock("@/lib/actions/membership-plans", () => ({
  listPlanTemplatesAction: async () => [],
  listPlansAction: async () => [],
}));
vi.mock("@/lib/actions/activities", () => ({
  listActivitiesAction: async () => [],
}));
vi.mock("@/lib/actions/people", () => ({
  listLocationsAction: async () => [],
}));
vi.mock("@/lib/actions/menu", () => ({
  listMenuAction: async () => ({ categories: [], items: [] }),
}));
vi.mock("@/lib/actions/branding", () => ({
  getBrandingAction: async () => ({
    displayName: "Worli Sports",
    shortName: "Worli",
    accent: "emerald",
    fallbackDisplayName: "Worli Sports",
    fallbackShortName: "Worli",
  }),
}));
vi.mock("@/lib/actions/holidays", () => ({
  listHolidaysAction: async () => [],
  addHolidayAction: vi.fn(),
  removeHolidayAction: vi.fn(),
}));
vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({}),
}));

// The holidays board refreshes the router after a change. There is no app
// router in a component test, so the hook is stubbed — this is test
// scaffolding, not a product change.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  notFound: () => {
    throw new Error("notFound");
  },
}));

// The heavy editors are stubbed: this test is about each page's own copy.
vi.mock("@/components/skill-ladder-manager", () => ({
  SkillLadderManager: () => <div data-testid="skill-ladder-manager" />,
}));
vi.mock("@/components/plan-manager", () => ({
  PlanManager: () => <div data-testid="plan-manager" />,
}));
vi.mock("@/components/menu-manager", () => ({
  MenuManager: () => <div data-testid="menu-manager" />,
}));
vi.mock("@/components/branding/branding-form", () => ({
  BrandingForm: () => <div data-testid="branding-form" />,
}));
vi.mock("@/components/terminology/terminology-form", () => ({
  TerminologyForm: () => <div data-testid="terminology-form" />,
}));

import SettingsPage from "@/app/(owner)/owner/settings/page";
import LocationsPage from "@/app/(owner)/owner/settings/locations/page";
import SkillsPage from "@/app/(owner)/owner/settings/skills/page";
import PlansPage from "@/app/(owner)/owner/settings/plans/page";
import MenuPage from "@/app/(owner)/owner/settings/menu/page";
import BrandingPage from "@/app/(owner)/owner/settings/branding/page";
import HolidaysPage from "@/app/(owner)/owner/settings/holidays/page";
import TerminologyPage from "@/app/(owner)/owner/settings/terminology/page";

afterEach(cleanup);

describe("Owner Settings — the visible purpose lines", () => {
  it("does not tell the owner on the Settings index to choose a task", async () => {
    const { container } = render(await SettingsPage({ searchParams: Promise.resolve({}) }));

    // INTENDED RED today.
    expect(container.textContent ?? "").not.toContain(
      "Choose the task you need to complete.",
    );
  });

  it("makes the theme destination discoverable as 'Theme & artwork'", async () => {
    render(await SettingsPage({ searchParams: Promise.resolve({}) }));

    // INTENDED RED today: the entry is named "Appearance".
    const link = screen.getByRole("link", { name: "Open Theme & artwork" });
    expect(link.getAttribute("href")).toBe("/owner/settings/appearance");
  });

  it("does not describe the internal framework behind the skill ladder", async () => {
    const { container } = render(await SkillsPage());
    const text = container.textContent ?? "";

    // INTENDED RED today.
    expect(text).not.toContain("generic framework");
    expect(text).not.toContain("stays as seeded");
    // The task itself stays described.
    expect(text).toContain("The levels and skills coaches assess against");
  });

  it("does not describe the internal column model behind the vocabulary route", async () => {
    const { container } = render(await TerminologyPage({ searchParams: Promise.resolve({}) }));
    const text = container.textContent ?? "";

    // INTENDED RED today.
    expect(text).not.toContain("Database columns");
    expect(text).not.toContain("canonical");
    expect(text).toContain("Eight terms the academy can rename");
    // The language-scope clarification stays — it is the useful part.
    expect(text).toMatch(
      /actual display locale lives on the coach \/ parent-side surfaces/i,
    );
  });

  it("does not describe an internal concept switch on the second site", async () => {
    const { container } = render(await LocationsPage());
    const text = container.textContent ?? "";

    // INTENDED RED today: the add-a-site note says a second site "turns on
    // the location concept across Aqua".
    expect(text).not.toContain("turns on the location concept");
    // The consequence the owner cares about survives.
    expect(text).toContain("per-site");
  });

  it("does not repeat the board's own promise on the holidays page", async () => {
    const { container } = render(await HolidaysPage());
    const text = container.textContent ?? "";

    // INTENDED RED today: the page repeats the empty-state promise.
    expect(text).not.toContain("leave a coach with an empty register");
    // The recurrence rule stays.
    expect(text).toContain("Recurring holidays repeat every year on the same date.");
  });

  it("keeps exactly one statement that generated sessions are not cancelled", async () => {
    render(await HolidaysPage());

    // CONTROL (green today): the warning is real and must not be erased
    // and must not be duplicated by the page's own copy.
    const warnings = screen.getAllByText(
      /does not cancel sessions already generated/i,
    );
    expect(warnings).toHaveLength(1);
  });

  it("keeps the café menu's tax facts and the reception read-only scope", async () => {
    const { container } = render(await MenuPage());
    const text = container.textContent ?? "";

    // CONTROL (green today): tax facts appear exactly once, and the
    // reception scope statement stays.
    expect(text.match(/GST/g) ?? []).toHaveLength(1);
    expect(text.match(/SAC/g) ?? []).toHaveLength(1);
    expect(text).toMatch(/Reception sees this menu/);
    expect(text).toMatch(/cannot change it/);
    // INTENDED RED today: the page repeats the visible task.
    expect(text).not.toContain("Categories and items the counter sells");
  });

  it("keeps the plan scope and drops the visible-task enumeration", async () => {
    const { container } = render(await PlansPage());
    const text = container.textContent ?? "";

    expect(text).toContain("Subscriptions are started from a member's page.");
    // INTENDED RED today.
    expect(text).not.toContain("durations, session packs and one-time plans");
    // The plan editor itself is untouched.
    expect(screen.getByTestId("plan-manager")).toBeTruthy();
  });

  it("does not enumerate the branding form's own fields", async () => {
    const { container } = render(await BrandingPage());
    const text = container.textContent ?? "";

    // INTENDED RED today.
    expect(text).not.toContain("display name, short name and accent");
    expect(screen.getByTestId("branding-form")).toBeTruthy();
  });
});
