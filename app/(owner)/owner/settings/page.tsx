import { requireLiveOwnerSettingsPage } from "@/lib/auth/owner-settings-page-guard";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left.mjs";
import ListChecks from "lucide-react/dist/esm/icons/list-checks.mjs";
import { getCurrentStaffIdentity } from "@/lib/services/staff";
import { getOnboardingChecklistAction } from "@/lib/actions/onboarding-checklist";
import { TenantSignOut } from "@/components/tenant-sign-out";
import { listAdminLocationsAction } from "@/lib/actions/locations";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { formatPhoneIN } from "@/lib/phone";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { OptionalWorkspaceGuide } from "@/components/onboarding/optional-workspace-guide";
import { PageHeader, SectionHeading } from "@/components/ui/PageHeader";
import {
  categoryIcon,
  settingCategories,
  SettingsSurfaceItems,
  SettingsTaskSurface,
} from "@/components/settings/settings-surfaces";

// Owner OpenPen management lane (29 October 2026).
//
// Settings is ONE page of six TASK surfaces — Academy, Programs &
// facilities, Fees & payments, Team & access, Communications and
// Appearance & advanced. Every destination is one click away and the
// row's accessible name says what it opens ("Open Academy profile"),
// because the visible word alone ("Open") repeats across the page.
//
// The index carries no purpose line of its own: the six surfaces and
// their rows already say what each task is. The `?category=` deep link
// still opens one surface, and that surface keeps its one-line scope.
//
// The account block is its own section below the task groups. Personal
// appearance stays the shell's control (system-owned); tenant branding
// remains a separate Settings destination.
//
// `?category=` is still rendered as a single-surface view. It is the
// existing deep-link shape used by older links and tests, and it keeps
// the same surface/row composition.
//
// Two entries are gated at runtime, because the academy decides them:
// the skill ladder is only offered when the module is on, and a
// single-site tenant never sees the concept of multiple locations.

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
  const locations = await listAdminLocationsAction();
  const multiLocation = locations.length > 1;
  // W1-6 continuation — the checklist is a first-run aid, so it is
  // gone from every owner surface once complete.
  const checklist = await getOnboardingChecklistAction().catch(() => null);
  const hasChecklist = checklist !== null && checklist.items.length > 0;
  const fullChecklist = hasChecklist && !checklist.scopeIsLimited && checklist.totalCount === 3 && checklist.items.length === 3 &&
    ["add_members", "create_batch", "assign_coach"].every((key) => checklist.items.some((item) => item.key === key));
  const setupComplete = fullChecklist && checklist.items.every((item) => item.complete);

  const CATEGORIES = settingCategories({
    ladderEnabled,
    multiLocation,
    // The booking desk needs bookings.read AND the pool.booking
    // entitlement; without either the route does not exist for the
    // caller, so the link is withheld rather than offered and broken.
    canReadBookings:
      ctx.permissions.has("bookings.read") && ctx.features.has("pool.booking"),
  });
  const active = CATEGORIES.find((c) => c.key === params.category);

  return (
    <OwnerPage>
      {active ? (
        <Link
          href="/owner/settings"
          className="inline-flex min-h-11 items-center gap-1.5 text-[13px] font-medium text-ink-2"
        >
          <ChevronLeft size={16} className="text-ink-3" aria-hidden="true" />
          Settings
        </Link>
      ) : null}

      <PageHeader
        title={active ? active.label : "Settings"}
        purpose={active ? active.summary : undefined}
        className="mt-1"
      />

      {!active ? (
        <section aria-labelledby="club-setup-heading" className="mt-5 rounded-card border border-line bg-paper p-4 sm:p-5">
          <h2 id="club-setup-heading" className="font-display text-[16px] font-semibold text-ink">Club setup</h2>
          <p className="mt-1 text-[13px] text-ink-2">
            A club can have multiple physical facilities. Add resources at each site, then review the club profile and prices.
            Open each step to review or change its details.
          </p>
          <OptionalWorkspaceGuide
            title="A little help with club setup"
            intro="Review these setup areas at your own pace. The guide does not change your settings."
            regionLabel="Optional club setup guide"
            itemLabel="Setup area"
            items={[
              { key: "facilities", title: "Physical facilities", detail: "Review the physical places where your club operates." },
              { key: "resources", title: "Sports resources", detail: "Review the resources at each facility." },
              { key: "profile", title: "Club profile and GST", detail: "Review your club details." },
              { key: "plans", title: "Membership plan prices", detail: "Review your membership plans and their prices." },
              { key: "booking", title: "Booking slot prices", detail: "Review your booking slot prices." },
            ]}
          />
          <ol className="mt-2 space-y-1 text-[13px]">
            <li><Link className="inline-flex min-h-11 items-center text-[var(--accent-ink)] underline underline-offset-2" href="/owner/settings/locations">1. Physical facilities</Link></li>
            <li><Link className="inline-flex min-h-11 items-center text-[var(--accent-ink)] underline underline-offset-2" href="/owner/settings/activities">2. Sports resources</Link></li>
            <li><Link className="inline-flex min-h-11 items-center text-[var(--accent-ink)] underline underline-offset-2" href="/owner/settings/academy">3. Club profile &amp; GST</Link></li>
            <li><Link className="inline-flex min-h-11 items-center text-[var(--accent-ink)] underline underline-offset-2" href="/owner/settings/plans">4. Membership plan prices</Link></li>
            <li><Link className="inline-flex min-h-11 items-center text-[var(--accent-ink)] underline underline-offset-2" href="/owner/settings/booking-prices">5. Booking slot prices</Link></li>
          </ol>
        </section>
      ) : null}

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
        <div className="mt-5 grid items-start gap-5 lg:grid-cols-2">
          {CATEGORIES.map((category) => (
            <SettingsTaskSurface
              key={category.key}
              title={category.label}
              icon={categoryIcon(category.key)}
            >
              <SettingsSurfaceItems items={category.items} hideDetail={category.key !== "appearance"} />
            </SettingsTaskSurface>
          ))}
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
      </section>
    </OwnerPage>
  );
}
