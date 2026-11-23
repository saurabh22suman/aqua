// @vitest-environment jsdom
//
// Lane: finish/settings. These are mocked unit checks for the Owner
// settings workflow hierarchy: recoverable reads, prerequisites before a
// dependent catalogue, and a truthful route back to the settings hub.
// They are NOT browser proof; the coordinator re-verifies the integrated
// build in a real browser.
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

type LocationRow = {
  id: string;
  name: string;
  kind: "club" | "cafe" | "mixed";
  isPrimary: boolean;
  address: null;
  createdAt: string;
};

const state = vi.hoisted(() => ({
  permissions: new Set([
    "settings.manage",
    "settings.read",
    "members.read",
    "bookings.read",
    "reports.operational",
    "dashboard.view",
    "levels.read",
    "levels.write",
    "programs.write",
  ]),
  features: new Set(["messaging", "reports", "swim.levels"]),
  locations: [] as LocationRow[],
  activities: [] as Array<{ id: string; name: string; locationId: string; locationName?: string }>,
  config: [] as Array<Record<string, unknown>>,
  configFail: false,
  holidays: [] as Array<Record<string, unknown>>,
  holidaysFail: false,
  threshold: 25,
  alertsFail: false,
  qrs: [] as Array<Record<string, unknown>>,
  menu: { categories: [] as Array<Record<string, unknown>>, items: [] as Array<Record<string, unknown>> },
  siteBilling: {
    ok: true as const,
    value: {
      locationId: "11111111-1111-4111-8111-111111111111",
      locationName: "North site",
      inheritsClubDefault: true,
      legalName: null,
      legalAddress: null,
      stateCode: null,
      gstin: null,
    },
  },
  clubBilling: {
    ok: true as const,
    value: { legalName: null, legalAddress: null, stateCode: null, gstin: null },
  },
  profile: { name: "Test Club", currency: "INR", timezone: "Asia/Kolkata" },
  branding: {
    displayName: null,
    fallbackDisplayName: "Synthetic club",
    shortName: null,
    fallbackShortName: "SC",
    accent: "mango",
    logoUrl: null,
  },
  roleOptions: null as null | { current: string; choices: { label: string; href: string; detail: string }[] },
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => "/owner/settings",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

vi.mock("@/components/owner-ui/owner-link", () => ({
  OwnerLink: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    tenantId: "club",
    userId: "owner",
    roleKey: "owner",
    allLocations: true,
    permissions: state.permissions,
    features: state.features,
  }),
  requirePagePermission: () => {},
}));
vi.mock("@/lib/actions/people", () => ({ listLocationsAction: async () => state.locations }));
vi.mock("@/lib/auth/permission", () => ({
  hasPermission: (_ctx: unknown, key: string) => state.permissions.has(key),
  hasFeature: (_ctx: unknown, key: string) => state.features.has(key),
}));
vi.mock("@/lib/auth/booking-entitlement", () => ({ hasBookingEntitlement: () => true }));
vi.mock("@/lib/auth/owner-settings-page-guard", () => ({ requireLiveOwnerSettingsPage: async () => {} }));
vi.mock("@/lib/auth/workspace-roles", () => ({ readStaffWorkspaceRoles: async () => state.roleOptions }));

vi.mock("@/db/tenant", () => ({ withTenant: async (_tenantId: string, fn: (tx: unknown) => unknown) => fn({}) }));
vi.mock("@/db/club-selection", () => ({
  clubDisplayName: (fallback: string, branding: { displayName?: string | null }) => branding.displayName ?? fallback,
}));

vi.mock("@/lib/services/branding", () => ({ getBranding: async () => state.branding }));
vi.mock("@/lib/services/staff", () => ({ getCurrentStaffIdentity: async () => ({ fullName: "Owner", phone: null }) }));
vi.mock("@/lib/services/location-access", () => ({
  locationVisible: () => true,
  resolveLocationAccess: async () => ({}),
}));
vi.mock("@/lib/services/workspace-opening", () => ({ ownerDefaultFacilityKey: () => "default-facility-key" }));
vi.mock("@/lib/services/people", () => ({ listLocations: async () => state.locations }));

vi.mock("@/lib/actions/locations", () => ({
  listAdminLocationsAction: async () => state.locations,
  createLocationAction: vi.fn(),
  updateLocationAction: vi.fn(),
  getBusinessHoursAction: vi.fn(),
  setBusinessHoursAction: vi.fn(),
}));
vi.mock("@/lib/actions/onboarding-checklist", () => ({ getOnboardingChecklistAction: async () => null }));
vi.mock("@/lib/actions/tenant-profile", () => ({
  getTenantProfileAction: async () => state.profile,
  updateTenantProfileAction: vi.fn(),
}));
vi.mock("@/lib/actions/facility-billing", () => ({
  getClubBillingDefaultAction: async () => state.clubBilling,
  getSiteBillingSettingAction: async () => state.siteBilling,
  saveClubBillingDefaultAction: vi.fn(),
  saveSiteBillingSettingAction: vi.fn(),
}));
vi.mock("@/lib/actions/activities", () => ({
  listActivitiesAction: async () => state.activities,
  addSubUnitAction: vi.fn(),
  createActivityAction: vi.fn(),
  deleteActivityAction: vi.fn(),
  removeSubUnitAction: vi.fn(),
  updateActivityAction: vi.fn(),
}));
vi.mock("@/lib/actions/booking-price-admin", () => ({ listBookingPriceRulesAction: async () => [] }));
vi.mock("@/lib/actions/branding", () => ({
  getBrandingAction: async () => ({
    displayName: null,
    fallbackDisplayName: "Synthetic club",
    shortName: null,
    fallbackShortName: "SC",
    accent: "mango",
    logoUrl: null,
  }),
}));
vi.mock("@/lib/actions/terminology", () => ({ getTerminologyAction: async () => ({ locale: "en", overrides: {} }) }));
vi.mock("@/lib/actions/absence-alerts", () => ({
  getAbsenceAlertThresholdAction: async () => {
    if (state.alertsFail) throw new Error("threshold unavailable");
    return state.threshold;
  },
  updateAbsenceAlertThresholdAction: vi.fn(),
}));
vi.mock("@/lib/actions/owner-config", () => ({
  listOwnerVisibleConfigAction: async () => {
    if (state.configFail) throw new Error("registry unavailable");
    return state.config;
  },
  setOwnerConfigValueAction: vi.fn(),
  requestConfigChangeAction: vi.fn(),
}));
vi.mock("@/lib/actions/holidays", () => ({
  listHolidaysAction: async () => {
    if (state.holidaysFail) throw new Error("holidays unavailable");
    return state.holidays;
  },
  addHolidayAction: vi.fn(),
  removeHolidayAction: vi.fn(),
}));
vi.mock("@/lib/actions/closure-review", () => ({ reviewClosureAction: async () => null }));
vi.mock("@/lib/actions/menu", () => ({ listMenuAction: async () => state.menu }));
vi.mock("@/lib/actions/payment-qrs", () => ({ listPaymentQrsAction: async () => state.qrs }));
vi.mock("@/lib/actions/membership-plans", () => ({
  listPlanTemplatesAction: async () => [],
  listPlansAction: async () => [],
}));
vi.mock("@/lib/actions/skill-ladder", () => ({ listSkillLaddersAction: async () => [] }));
vi.mock("@/lib/actions/owner-default-facility", () => ({ saveOwnerDefaultFacilityAction: vi.fn() }));

vi.mock("@/components/branding/club-mark", () => ({ ClubMark: () => <span>Club mark</span> }));
vi.mock("@/components/tenant-sign-out", () => ({ TenantSignOut: () => <span>Sign out</span> }));
vi.mock("@/components/staff-club-install-link", () => ({ StaffClubInstallLink: () => <span>Install club</span> }));
vi.mock("@/components/onboarding/guide-help-button", () => ({
  OpenWorkspaceGuideLink: () => <a href="/owner#workspace-guide">Help: open guide</a>,
}));
vi.mock("@/components/settings/academy-profile-form", () => ({ AcademyProfileForm: () => <h2>Club identity</h2> }));
vi.mock("@/components/settings/facility-club-billing-form", () => ({ FacilityClubBillingForm: () => <h2>Club default</h2> }));
vi.mock("@/components/settings/facility-billing-form", () => ({ FacilityBillingForm: () => <h2>Facility billing</h2> }));
vi.mock("@/components/settings/business-hours-editor", () => ({ BusinessHoursEditor: () => <p>Hours</p> }));
vi.mock("@/components/settings/owner-theme-choice", () => ({ OwnerThemeChoice: () => <p>Theme choice</p> }));
vi.mock("@/components/owner-artwork/owner-artwork", () => ({ OwnerArtwork: () => <p>Artwork chooser</p> }));
vi.mock("@/components/activity-manager", () => ({ ActivityManager: () => <p>Activity manager</p> }));
vi.mock("@/components/alert-settings-form", () => ({ AlertSettingsForm: () => <p>Alert form</p> }));
vi.mock("@/components/bookings/booking-price-manager", () => ({ BookingPriceManager: () => <p>Booking price manager</p> }));
vi.mock("@/components/branding/branding-form", () => ({ BrandingForm: () => <p>Branding form</p> }));
vi.mock("@/components/owner-config-form", () => ({ OwnerConfigForm: () => <p>Config form</p> }));
vi.mock("@/components/holidays-board", () => ({ HolidaysBoard: () => <p>Holidays board</p> }));
vi.mock("@/components/menu-manager", () => ({ MenuManager: () => <p>Menu manager</p> }));
vi.mock("@/components/payment-qr-manager", () => ({ PaymentQrManager: () => <p>Payment QR manager</p> }));
vi.mock("@/components/plan-manager", () => ({ PlanManager: () => <p>Plan manager</p> }));
vi.mock("@/components/skill-ladder-manager", () => ({ SkillLadderManager: () => <p>Skill ladder manager</p> }));
vi.mock("@/components/reports/owner-approved/report-preferences", () => ({
  ReportPreferencesEditor: () => <p>Report preferences</p>,
}));
vi.mock("@/components/terminology/terminology-form", () => ({ TerminologyForm: () => <p>Terminology form</p> }));
vi.mock("@/components/settings/owner-default-facility-form", () => ({
  OwnerDefaultFacilityForm: () => <p>Default facility form</p>,
}));

import SettingsPage from "@/app/(owner)/owner/settings/page";
import AcademySettingsPage from "@/app/(owner)/owner/settings/academy/page";
import ActivitiesPage from "@/app/(owner)/owner/settings/activities/page";
import AlertSettingsPage from "@/app/(owner)/owner/settings/alerts/page";
import BrandingSettingsPage from "@/app/(owner)/owner/settings/branding/page";
import OwnerAppearancePage from "@/app/(owner)/owner/settings/appearance/page";
import BookingPricesPage from "@/app/(owner)/owner/settings/booking-prices/page";
import OwnerConfigurationPage from "@/app/(owner)/owner/settings/configuration/page";
import HolidaysPage from "@/app/(owner)/owner/settings/holidays/page";
import FacilitySettingsPage from "@/app/(owner)/owner/settings/locations/[locationId]/page";
import OwnerMenuPage from "@/app/(owner)/owner/settings/menu/page";
import PaymentQrsPage from "@/app/(owner)/owner/settings/payment-qrs/page";
import PlansPage from "@/app/(owner)/owner/settings/plans/page";
import OwnerSkillsPage from "@/app/(owner)/owner/settings/skills/page";
import OwnerWorkspaceSettingsPage from "@/app/(owner)/owner/settings/workspace/page";
import { LocationManager } from "@/components/settings/location-manager";

const locations: LocationRow[] = [
  { id: "site-a", name: "North", kind: "club", isPrimary: true, address: null, createdAt: "2026-01-01T00:00:00.000Z" },
  { id: "site-b", name: "South", kind: "club", isPrimary: false, address: null, createdAt: "2026-01-02T00:00:00.000Z" },
];

beforeEach(() => {
  state.roleOptions = null;
  state.locations = locations;
  state.activities = [];
  state.config = [];
  state.configFail = false;
  state.holidays = [];
  state.holidaysFail = false;
  state.alertsFail = false;
  state.qrs = [];
  state.menu = { categories: [], items: [] };
  state.permissions = new Set([
    "settings.manage",
    "settings.read",
    "members.read",
    "bookings.read",
    "reports.operational",
    "dashboard.view",
    "levels.read",
    "levels.write",
    "programs.write",
  ]);
  state.features = new Set(["messaging", "reports", "swim.levels"]);
});

it("lets an Owner open their assigned Family sign-in from account settings", async () => {
  state.roleOptions = {
    current: "Owner",
    choices: [{ label: "Family", href: "/family/sign-in?clubId=club", detail: "Confirm with your PIN" }],
  };
  render(await SettingsPage({}));
  fireEvent.click(screen.getByText("Switch role", { exact: true }));
  const account = within(screen.getByRole("region", { name: "Your account" }));
  expect(account.getByText("Current role · Owner")).toBeTruthy();
  expect(account.getByRole("link", { name: /Family/ }).getAttribute("href")).toBe("/family/sign-in?clubId=club");
  expect(account.queryByRole("link", { name: /Member|Coach/ })).toBeNull();
});

it("keeps the switcher out of Settings when no other role is available", async () => {
  state.roleOptions = { current: "Owner", choices: [] };
  render(await SettingsPage({}));
  expect(screen.queryByText("Switch role", { exact: true })).toBeNull();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("keeps a manage-clubs route on the settings overview after the club cards", async () => {
  render(await SettingsPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByRole("heading", { name: "Club settings" })).toBeTruthy();
  const manage = screen.getByRole("link", { name: "Manage clubs" });
  expect(manage.getAttribute("href")).toBe("/owner/settings/locations");
});

it("states that the two academy saves are independent", async () => {
  render(await AcademySettingsPage());
  expect(screen.getByText(/save separately/i)).toBeTruthy();
});

it("returns from resources through Settings and offers the next catalogues", async () => {
  render(await ActivitiesPage());
  expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/owner/settings");
  expect(screen.getByRole("link", { name: "Next: Membership plans" }).getAttribute("href")).toBe(
    "/owner/settings/plans",
  );
  expect(screen.getByRole("link", { name: "Next: Booking slot prices" }).getAttribute("href")).toBe(
    "/owner/settings/booking-prices",
  );
  expect(screen.queryByRole("link", { name: /Club profile/i })).toBeNull();
});

it("recovers an absence-alert threshold read instead of crashing", async () => {
  state.alertsFail = true;
  render(await AlertSettingsPage());
  expect(screen.getByRole("alert").textContent).toMatch(/could not load/i);
  expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe(
    "/owner/settings/alerts",
  );
});

it("distinguishes display branding from the legal club profile", async () => {
  render(await BrandingSettingsPage());
  expect(screen.getByRole("link", { name: "Club profile & GST" }).getAttribute("href")).toBe(
    "/owner/settings/academy",
  );
});

it("names appearance by the destination the settings hub offers and provides a way back", async () => {
  render(await OwnerAppearancePage());
  expect(screen.getByRole("heading", { level: 1, name: "Theme & artwork" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/owner/settings");
});

it("explains the missing sports resource before booking prices", async () => {
  state.activities = [];
  render(await BookingPricesPage({ searchParams: Promise.resolve({}) }));
  const note = screen.getByTestId("settings-prerequisite");
  expect(note.textContent).toMatch(/no sports resources yet/i);
  expect(within(note).getByRole("link", { name: "Add sports resources" }).getAttribute("href")).toBe(
    "/owner/settings/activities",
  );
});

it("distinguishes an unavailable rules read from an empty one and offers a retry", async () => {
  state.configFail = true;
  render(await OwnerConfigurationPage());
  expect(screen.getByRole("alert").textContent).toMatch(/could not load/i);
  expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe(
    "/owner/settings/configuration",
  );
  expect(screen.queryByText(/nothing is configurable/i)).toBeNull();
  expect(screen.getByRole("link", { name: "Absence alerts" }).getAttribute("href")).toBe(
    "/owner/settings/alerts",
  );
});

it("counts effective rules so a long rules list has a visible size", async () => {
  state.config = [
    { key: "operations.business_hours", value: null, source: { scope: "tenant", setAt: null } },
  ];
  render(await OwnerConfigurationPage());
  expect(screen.getByText(/1 effective rule\b/i)).toBeTruthy();
});

it("recovers a holidays read instead of rendering an empty calendar", async () => {
  state.holidaysFail = true;
  render(await HolidaysPage());
  expect(screen.getByRole("alert").textContent).toMatch(/could not load/i);
  expect(screen.getByRole("link", { name: "Try again" }).getAttribute("href")).toBe(
    "/owner/settings/holidays",
  );
  expect(screen.queryByText("Holidays board")).toBeNull();
});

it("names the first location as the first, not the second", () => {
  render(<LocationManager initial={[]} canWrite />);
  expect(screen.getByRole("heading", { name: "Add your first location" })).toBeTruthy();
  expect(screen.queryByText("Add a second location")).toBeNull();
  cleanup();
  render(<LocationManager initial={[locations[0]!]} canWrite />);
  expect(screen.getByRole("heading", { name: "Add a second location" })).toBeTruthy();
});

it("lets a facility financial page reach the club details it belongs to", async () => {
  render(
    await FacilitySettingsPage({
      params: Promise.resolve({ locationId: "11111111-1111-4111-8111-111111111111" }),
    }),
  );
  expect(screen.getByRole("link", { name: "Edit club details and hours" }).getAttribute("href")).toBe(
    "/owner/settings/locations",
  );
});

it("states the facility prerequisite before a café menu can be built", async () => {
  state.locations = [];
  render(await OwnerMenuPage());
  const note = screen.getByTestId("settings-prerequisite");
  expect(within(note).getByRole("link", { name: "Add a physical facility" }).getAttribute("href")).toBe(
    "/owner/settings/locations",
  );
});

it("returns from payment QRs through Settings", async () => {
  render(await PaymentQrsPage());
  expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/owner/settings");
});

it("states the facility prerequisite before membership plans", async () => {
  state.locations = [];
  render(await PlansPage());
  const note = screen.getByTestId("settings-prerequisite");
  expect(within(note).getByRole("link", { name: "Add a physical facility" }).getAttribute("href")).toBe(
    "/owner/settings/locations",
  );
});

it("returns from the skill ladder through Settings even when the module is off", async () => {
  state.features = new Set();
  render(await OwnerSkillsPage());
  expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/owner/settings");
  expect(screen.getByText(/skill ladders aren't enabled/i)).toBeTruthy();
});

it("names the workspace preference after the destination and provides a way back", async () => {
  render(await OwnerWorkspaceSettingsPage());
  expect(screen.getByRole("heading", { level: 1, name: "Default facility" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Settings" }).getAttribute("href")).toBe("/owner/settings");
});
