import { requireLiveOwnerSettingsPage } from "@/lib/auth/owner-settings-page-guard";
import { hasBookingEntitlement } from "@/lib/auth/booking-entitlement";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left.mjs";
import ListChecks from "lucide-react/dist/esm/icons/list-checks.mjs";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.mjs";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { ClubMark } from "@/components/branding/club-mark";
import { OpenWorkspaceGuideLink } from "@/components/onboarding/guide-help-button";
import { getCurrentStaffIdentity } from "@/lib/services/staff";
import { getOnboardingChecklistAction } from "@/lib/actions/onboarding-checklist";
import { TenantSignOut } from "@/components/tenant-sign-out";
import { StaffClubInstallLink } from "@/components/staff-club-install-link";
import { listAdminLocationsAction } from "@/lib/actions/locations";
import { withTenant } from "@/db/tenant";
import { clubDisplayName } from "@/db/club-selection";
import { getBranding } from "@/lib/services/branding";
import { locationVisible, resolveLocationAccess } from "@/lib/services/location-access";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { formatPhoneIN } from "@/lib/phone";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { OwnerDesignHeading } from "@/components/owner-approved/owner-design-heading";
import { SectionHeading } from "@/components/ui/PageHeader";
import {
  categoryIcon,
  settingCategories,
  SettingsSurfaceItems,
  SettingsTaskSurface,
} from "@/components/settings/settings-surfaces";

// Club identity, scoped facilities and personal choices are separate tasks.
// Existing category deep links and each destination's server guard remain intact.

export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<{ category?: string }>;
}) {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "settings.manage");
  await requireLiveOwnerSettingsPage(ctx);

  const params = searchParams ? await searchParams : {};

  // V-09 — the ladder editor is only offered when the module is on.
  const ladderEnabled = ctx.features.has("swim.levels");
  const identity = await getCurrentStaffIdentity(ctx);
  // U-07 — a single-location tenant never sees the concept of multiple
  // sites: the label stays singular until a second location exists.
  const [allLocations, branding] = await Promise.all([listAdminLocationsAction(), getBranding(ctx).catch(() => null)]);
  const locations = ctx.allLocations !== false ? allLocations : await withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    return allLocations.filter((location) => locationVisible(access, location.id));
  });
  const multiLocation = locations.length > 1;
  // W1-6 continuation — the checklist is a first-run aid, so it is
  // gone from every owner surface once complete.
  const checklist = await getOnboardingChecklistAction().catch(() => null);
  const hasChecklist = checklist !== null && checklist.items.length > 0;
  const fullChecklist = hasChecklist && !checklist.scopeIsLimited && checklist.totalCount === 3 && checklist.items.length === 3 &&
    ["add_members", "create_batch", "assign_coach"].every((key) => checklist.items.some((item) => item.key === key));
  const setupComplete = fullChecklist && checklist.items.every((item) => item.complete);

  const destinationPermissions: Readonly<Record<string, readonly string[]>> = {
    "/owner/programs": ["programs.read"],
    "/owner/staff": ["staff.read"],
    "/owner/staff/invitations": ["staff.invite"],
    "/owner/announcements": ["messaging.send", "members.read", "programs.read"],
    "/owner/bookings": ["bookings.read", "members.read"],
    "/owner/settings/academy": ["settings.read"],
    "/owner/settings/locations": ["settings.read"],
    "/owner/settings/activities": ["settings.read", "members.read"],
    "/owner/settings/plans": ["settings.read", "members.read"],
    "/owner/settings/menu": ["settings.read", "members.read"],
    "/owner/settings/booking-prices": ["settings.read"],
    "/owner/settings/payment-qrs": ["settings.read"],
    "/owner/settings/skills": ["levels.read"],
    "/owner/settings/reports": ["reports.operational"],
  };
  const CATEGORIES = settingCategories({
    ladderEnabled,
    multiLocation,
    // The booking desk needs bookings.read AND the pool.booking
    // entitlement; without either the route does not exist for the
    // caller, so the link is withheld rather than offered and broken.
    canReadBookings:
      ctx.permissions.has("bookings.read") && hasBookingEntitlement(ctx.features),
  }).map((category) => ({
    ...category,
    items: category.items.filter((item) => {
      const permissions = destinationPermissions[item.href] ?? [];
      return permissions.every((permission) => ctx.permissions.has(permission)) &&
        (item.href !== "/owner/announcements" || ctx.features.has("messaging")) &&
        (item.href !== "/owner/settings/reports" || ctx.features.has("reports"));
    }),
  })).filter((category) => category.items.length > 0);
  const active = CATEGORIES.find((c) => c.key === params.category);
  const groups = [
    { label: "Business administration", categories: CATEGORIES.filter((category) => category.key !== "appearance") },
    { label: "Personal preferences", categories: CATEGORIES.filter((category) => category.key === "appearance") },
  ];

  return (
    <OwnerPage>
      {active ? (
        <a
          href="/owner/settings"
          className="inline-flex min-h-11 items-center gap-1.5 text-[13px] font-medium text-ink-2"
        >
          <ChevronLeft size={16} className="text-ink-3" aria-hidden="true" />
          Settings
        </a>
      ) : null}

      <OwnerDesignHeading
        title={active ? active.label : "Settings"}
        purpose={active ? active.summary : "Your business account, clubs and preferences"}
        className="mt-1"
      />

      {!active ? <>
        <section aria-label="Business account" className="flex min-w-0 flex-wrap items-center gap-3 rounded-[18px] border border-line bg-paper p-[18px] lg:p-5">
          {branding ? <ClubMark name={clubDisplayName(branding.fallbackDisplayName, branding)} logoUrl={branding.logoUrl} accent={branding.accent} size={44} /> : null}
          <div className="min-w-0 flex-1"><p className="text-[11px] font-medium uppercase tracking-[0.1em] text-ink-2">Business account</p>
            <p className="mt-1 break-words font-display text-[18px] font-semibold">{branding ? clubDisplayName(branding.fallbackDisplayName, branding) : "Business account unavailable"}</p>
            <p className="mt-1 text-[12px] text-ink-2">{locations.length} {locations.length === 1 ? "club" : "clubs"}</p>
          </div>
          {branding ? <Link href="/owner/settings/academy" className="inline-flex min-h-11 items-center text-[13px] font-medium text-[var(--accent-ink)]">Manage</Link> : <Link href="/owner/settings" className="inline-flex min-h-11 items-center text-[13px] text-[var(--accent-ink)] underline">Retry business account</Link>}
        </section>
        <section className="mt-5" aria-labelledby="facility-settings-heading">
          <h2 id="facility-settings-heading" className="font-display text-[18px] font-semibold">Club settings</h2>
          {locations.length ? <ul className="mt-3 grid gap-3 lg:grid-cols-2">
            {locations.map((location) => <li key={location.id}>
              <Link href={`/owner/settings/locations/${location.id}`} aria-label={`Club: ${location.name}`} className="flex min-h-11 items-center gap-3 rounded-[18px] border border-line bg-paper p-[18px] focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] lg:p-5">
                <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-ink)]"><OwnerIcon name="pin" size={20} /></span><span className="min-w-0 flex-1 break-words text-[14px] font-medium">{location.name}</span><ChevronRight size={18} aria-hidden="true" />
              </Link>
            </li>)}
          </ul> : <p className="mt-2 text-[13px] text-ink-2">No clubs available to you.</p>}
        </section>
      </> : null}

      {hasChecklist && !setupComplete ? (
        <div className="mt-5">
          <Link
            href="/owner/onboarding"
            className="flex items-center gap-3 rounded-card border border-line bg-paper px-5 py-4"
            data-testid="settings-onboarding"
          >
            <span className="grid h-9 w-9 flex-none place-items-center rounded-[10px] bg-warn-soft text-warn">
              <ListChecks size={16} strokeWidth={2} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-medium leading-tight">
                {fullChecklist ? "Onboarding checklist" : "Available register checks"}
              </span>
              <span className="mt-0.5 block text-[12px] leading-tight text-ink-3">
                {fullChecklist ? "See what's left before members and coaches are ready to go." : "Review the checks available to you."}
              </span>
            </span>
            <span className="flex-none text-[13px] text-ink-3">Open</span>
          </Link>
        </div>
      ) : null}

      {active ? (
        <div className="mt-5">
          <SettingsTaskSurface
            title={active.label}
            icon={categoryIcon(active.key)}
          >
            <SettingsSurfaceItems items={active.items} />
          </SettingsTaskSurface>
        </div>
      ) : (
        <div className="mt-5 grid items-start gap-4 lg:grid-cols-2">
          {groups.map((group) => (
            <section key={group.label} className="min-w-0"><h2 className="font-display text-[18px] font-semibold">{group.label}</h2><div className="mt-3 overflow-hidden rounded-[18px] border border-line bg-paper px-[18px]">
          {group.label === "Personal preferences" ? group.categories.flatMap((category) => category.items).map((item) => (
            <Link key={item.href} href={item.href} aria-label={`Open ${item.label}`} className="flex min-h-11 items-center gap-3 border-b border-line py-3 hover:bg-deck focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]">
              <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-ink)]"><OwnerIcon name={item.href === "/owner/settings/appearance" ? "settings" : "reports"} size={20} /></span>
              <span className="min-w-0 flex-1"><span className="block text-[14px] font-medium text-ink">{item.label}</span><span className="mt-1 block text-[12px] leading-snug text-ink-3">{item.detail}</span></span>
              <ChevronRight size={18} className="flex-none text-ink-3" aria-hidden="true" />
            </Link>
          )) : group.categories.map((category) => (
            <a key={category.key} href={`/owner/settings?category=${category.key}`}
              aria-label={`Open ${category.label} settings`}
              className="flex min-h-11 min-w-0 items-center gap-3 border-b border-line py-3 last:border-0 hover:bg-deck focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]">
              {categoryIcon(category.key) ? <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-ink)]"><OwnerIcon name={categoryIcon(category.key)!} size={20} /></span> : null}
              <span className="min-w-0 flex-1">
                <span className="block break-words font-display text-[15px] font-semibold">{category.label}</span>
                <span className="mt-1 block text-[12px] text-ink-2">{category.summary}</span>
              </span>
              <ChevronRight size={18} className="flex-none text-ink-3" aria-hidden="true" />
            </a>
          ))}
          {group.label === "Personal preferences" && ctx.permissions.has("dashboard.view") ? <OpenWorkspaceGuideLink homeHref="/owner" /> : null}
          </div></section>))}
        </div>
      )}

      <section className="mt-5 rounded-card border border-line bg-paper p-5">
        <SectionHeading title="Your account" />
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3.5">
          <div className="min-w-0">
            <p className="text-[14px] font-medium leading-snug">
              {identity?.fullName ?? "Signed in"}
            </p>
            <p className="mt-0.5 font-mono text-[12.5px] text-ink-3">
              {identity?.phone ? formatPhoneIN(identity.phone) : "No phone on file"}
            </p>
          </div>
          <TenantSignOut />
        </div>
        <StaffClubInstallLink tenantId={ctx.tenantId} />
      </section>
    </OwnerPage>
  );
}
