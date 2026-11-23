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
import { readStaffWorkspaceRoles } from "@/lib/auth/workspace-roles";
import { formatPhoneIN } from "@/lib/phone";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { OwnerDesignHeading } from "@/components/owner-approved/owner-design-heading";
import { SectionHeading } from "@/components/ui/PageHeader";
import { WorkspaceRoleSwitch } from "@/components/settings/workspace-role-switch";
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
  searchParams?: Promise<{ category?: string; q?: string }>;
}) {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "settings.manage");
  await requireLiveOwnerSettingsPage(ctx);

  const params = searchParams ? await searchParams : {};

  // V-09 — the ladder editor is only offered when the module is on.
  const ladderEnabled = ctx.features.has("swim.levels");
  const [identity, roleOptions] = await Promise.all([
    getCurrentStaffIdentity(ctx),
    readStaffWorkspaceRoles(ctx).catch(() => undefined),
  ]);
  // U-07 — a single-location tenant never sees the concept of multiple
  // sites: the label stays singular until a second location exists.
  const [allLocations, branding] = await Promise.all([listAdminLocationsAction(), getBranding(ctx).catch(() => null)]);
  const locations = ctx.allLocations !== false ? allLocations : await withTenant(ctx.tenantId, async (tx) => {
    const access = await resolveLocationAccess(tx, ctx);
    return allLocations.filter((location) => locationVisible(access, location.id));
  });
  const multiLocation = locations.length > 1;
  // Completed setup is reachable from Help. Incomplete setup stays visible.
  const checklist = await getOnboardingChecklistAction().catch(() => null);
  const hasChecklist = checklist !== null && checklist.items.length > 0;
  const fullChecklist = hasChecklist && !checklist.scopeIsLimited && checklist.totalCount === 3 && checklist.items.length === 3 &&
    ["add_members", "create_batch", "assign_coach"].every((key) => checklist.items.some((item) => item.key === key));
  const setupComplete = fullChecklist && checklist.items.every((item) => item.complete);

  const destinationPermissions: Readonly<Record<string, readonly string[]>> = {
    "/owner/programs": ["programs.read"],
    "/owner/staff": ["staff.read"],
    "/owner/staff/invitations": ["staff.invite"],
    "/owner/bookings": ["bookings.read", "members.read"],
    "/owner/settings/academy": ["settings.read"],
    "/owner/settings/locations": ["settings.read"],
    "/owner/settings/activities": ["settings.read", "members.read"],
    "/owner/settings/plans": ["settings.read", "members.read"],
    "/owner/settings/menu": ["settings.read", "members.read"],
    "/owner/settings/booking-prices": ["settings.read"],
    "/owner/settings/payment-qrs": ["settings.read"],
    "/owner/settings/skills": ["levels.read"],
    "/owner/settings/workspace": ["dashboard.view"],
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
        (!["/owner/settings/workspace", "/owner/settings/reports"].includes(item.href) || ctx.features.has("reports"));
    }),
  })).filter((category) => category.items.length > 0);
  const category = params.category === "communications" ? "academy" : params.category;
  const active = CATEGORIES.find((candidate) => candidate.key === category);
  const searchQuery = typeof params.q === "string" ? params.q.trim().slice(0, 100) : "";
  const searchTerms = searchQuery.toLocaleLowerCase().split(/\s+/);
  const matchingItems = searchQuery ? CATEGORIES.flatMap(category => category.items).filter(item => {
    const reference = `${item.label} ${item.detail ?? ""}`.toLocaleLowerCase();
    return searchTerms.every(term => reference.includes(term));
  }) : [];
  const groups = [
    { label: "Business administration", categories: CATEGORIES.filter((category) => category.key !== "appearance") },
    { label: "Personal preferences", categories: CATEGORIES.filter((category) => category.key === "appearance") },
  ];

  return (
    <OwnerPage workflow="settings">
      {active ? (
        <Link
          href="/owner/settings"
          className="inline-flex min-h-11 items-center gap-1.5 text-[13px] font-medium text-ink-2"
        >
          <ChevronLeft size={16} className="text-ink-3" aria-hidden="true" />
          Settings
        </Link>
      ) : null}

      <OwnerDesignHeading
        title={active ? active.label : "Settings"}
        purpose={active ? active.summary : "Your business account, clubs and preferences"}
        className="mt-1"
      />

      {!active ? <form action="/owner/settings" className="owner-work-panel flex flex-wrap items-end gap-2">
        <label htmlFor="settings-search" className="grid min-w-0 flex-1 basis-48 gap-1 text-[13px] font-medium text-ink">
          Search settings
          <input id="settings-search" name="q" type="search" defaultValue={searchQuery} maxLength={100}
            className="min-h-11 w-full rounded-ctl border border-line bg-paper px-3 text-[16px]" />
        </label>
        <button type="submit" className="min-h-11 rounded-ctl bg-[var(--action-surface)] px-4 text-sm font-medium text-[var(--action-foreground)]">Find settings</button>
      </form> : null}

      {!active && !searchQuery ? <>
        <section aria-label="Business account" className="flex min-w-0 flex-wrap items-center gap-3 rounded-[18px] border border-line bg-paper p-[18px] lg:p-5">
          {branding ? <ClubMark name={clubDisplayName(branding.fallbackDisplayName, branding)} logoUrl={branding.logoUrl} accent={branding.accent} size={44} /> : null}
          <div className="min-w-0 flex-1"><p className="text-[11px] font-medium uppercase tracking-[0.1em] text-ink-2">Business account</p>
            <p className="mt-1 break-words font-display text-[18px] font-semibold">{branding ? clubDisplayName(branding.fallbackDisplayName, branding) : "Business account unavailable"}</p>
            <p className="mt-1 text-[12px] text-ink-2">{locations.length} {locations.length === 1 ? "club" : "clubs"}</p>
          </div>
          {branding ? <Link href="/owner/settings/academy" className="inline-flex min-h-11 items-center text-[13px] font-medium text-[var(--accent-ink)]">Manage</Link> : <Link href="/owner/settings" className="inline-flex min-h-11 items-center text-[13px] text-[var(--accent-ink)] underline">Retry business account</Link>}
        </section>
        <section className="mt-5" aria-labelledby="facility-settings-heading">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="facility-settings-heading" className="font-display text-[18px] font-semibold">Club settings</h2>
            {/* The overview cards open one club; this keeps the place where
                clubs are added or given their address and hours reachable
                without a detour through a club's financial page. */}
            <Link
              href="/owner/settings/locations"
              className="inline-flex min-h-11 items-center text-[13px] font-medium text-[var(--accent-ink)] underline underline-offset-2"
            >
              {locations.length === 1 ? "Manage club" : "Manage clubs"}
            </Link>
          </div>
          {locations.length ? <ul className="mt-3 grid gap-3 lg:grid-cols-2">
            {locations.map((location) => <li key={location.id}>
              <Link href={`/owner/settings/locations/${location.id}`} aria-label={`Club: ${location.name}`} className="flex min-h-11 items-center gap-3 rounded-[18px] border border-line bg-paper p-[18px] focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-[var(--focus-ring)] lg:p-5">
                <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-ink)]"><OwnerIcon name="pin" size={20} /></span><span className="min-w-0 flex-1 break-words text-[14px] font-medium">{location.name}</span><ChevronRight size={18} aria-hidden="true" />
              </Link>
            </li>)}
          </ul> : <p className="mt-2 text-[13px] text-ink-2">No clubs available to you.</p>}
        </section>
      </> : null}

      {hasChecklist && !setupComplete && !searchQuery ? (
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
      ) : searchQuery ? (
        <section aria-label="Settings results" className="mt-4 rounded-card border border-line bg-paper p-4">
          <SectionHeading title="Matching settings" trailing={<Link href="/owner/settings" className="inline-flex min-h-11 items-center text-sm text-[var(--accent-ink)] underline">Clear search</Link>} />
          {matchingItems.length ? <SettingsSurfaceItems items={matchingItems} /> : <p className="mt-2 text-sm text-ink-2">No settings match “{searchQuery}”.</p>}
        </section>
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
            <Link key={category.key} href={`/owner/settings?category=${category.key}`}
              aria-label={`Open ${category.label} settings`}
              className="flex min-h-11 min-w-0 items-center gap-3 border-b border-line py-3 last:border-0 hover:bg-deck focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]">
              {categoryIcon(category.key) ? <span className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-ink)]"><OwnerIcon name={categoryIcon(category.key)!} size={20} /></span> : null}
              <span className="min-w-0 flex-1">
                <span className="block break-words font-display text-[15px] font-semibold">{category.label}</span>
                <span className="mt-1 block text-[12px] text-ink-2">{category.summary}</span>
              </span>
              <ChevronRight size={18} className="flex-none text-ink-3" aria-hidden="true" />
            </Link>
          ))}
          </div></section>))}
        </div>
      )}

      {setupComplete || ctx.permissions.has("dashboard.view") ? (
        <details className="mt-5 rounded-card border border-line bg-paper px-5">
          <summary className="min-h-11 cursor-pointer py-3 font-medium text-ink">Help</summary>
          <div className="flex flex-wrap gap-x-5 border-t border-line pb-2">
            {ctx.permissions.has("dashboard.view") ? <OpenWorkspaceGuideLink homeHref="/owner" /> : null}
            {setupComplete ? (
              <Link href="/owner/onboarding" className="inline-flex min-h-11 items-center text-[13px] font-medium text-[var(--accent-ink)] underline underline-offset-2">
                Review completed setup
              </Link>
            ) : null}
          </div>
        </details>
      ) : null}

      <section aria-label="Your account" className="mt-5 rounded-card border border-line bg-paper p-5">
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
          <TenantSignOut showClubSwitch={roleOptions?.showBusinessSwitch ?? false} />
        </div>
        <WorkspaceRoleSwitch options={roleOptions} settingsHref="/owner/settings" className="mt-3" />
        <StaffClubInstallLink tenantId={ctx.tenantId} />
      </section>
    </OwnerPage>
  );
}
