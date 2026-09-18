import Link from "next/link";
import { Award, BellRing, CalendarOff, CreditCard, Dumbbell, LogOut, ChevronRight, Languages, ListChecks, MapPin, Megaphone, Palette, QrCode, SlidersHorizontal, Users, Utensils } from "lucide-react";
import { requireDefaultCtx } from "@/lib/auth/context";
import { requirePermission } from "@/lib/auth/permission";
import { getCurrentStaffIdentity } from "@/lib/services/staff";
import { logoutTenantAction } from "@/lib/actions/tenant-auth";
import { listAdminLocationsAction } from "@/lib/actions/locations";
import { requireOwner } from "@/lib/auth/surface-guard";
import { formatPhoneIN } from "@/lib/phone";

// F-23 — settings surface. Branding (Phase 2.9), Terminology
// (Phase 2.10), Staff (Phase 3.5) and the onboarding checklist
// (Phase 2.8) live here. U-07 adds the locations + business-hours
// editor; the label stays singular for a single-site tenant so the
// concept of multiple locations never appears until one exists.
// U-06's announcements entry point lives here too (in-app only).
//
// K2 — Account section at the foot of the page. The bottom nav's
// 4th slot is Settings (admin-y), not a "Me" tab, so the identity
// block + sign-out lives here instead. When a dedicated /owner/me
// lands it can replace this section in place.
export default async function Page() {
  await requireOwner();
  const ctx = await requireDefaultCtx();
  requirePermission(ctx, "members.read");
  // V-09 — the ladder editor is only offered when the module is on.
  const ladderEnabled = ctx.features.has("swim.levels");
  const identity = await getCurrentStaffIdentity(ctx);
  // U-07 — a single-location tenant never sees the concept of multiple
  // sites: the label stays singular until a second location exists.
  // The page itself is still reachable, because adding that second
  // location is the only way the concept ever becomes real.
  const locations = await listAdminLocationsAction();
  const multiLocation = locations.length > 1;

  return (
    <main className="px-5 pt-6 pb-8">
      <h1 className="font-display text-[19px] font-semibold">Settings</h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        Branding, vocabulary, staff and onboarding — everything the owner can change about the academy.
      </p>

      <h2 className="font-display text-[15px] font-semibold mt-7 mb-2.5">Setup</h2>
      <Link
        href="/owner/onboarding"
        className="flex items-center gap-3 bg-paper border border-line rounded-ctl px-3.5 min-h-[56px] py-3 mb-2"
      >
        <div className="h-9 w-9 rounded-[11px] grid place-items-center flex-none bg-warn-soft text-warn">
          <ListChecks size={16} strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium leading-tight">Onboarding checklist</p>
          <p className="mt-0.5 text-[12px] text-ink-3 leading-tight">
            See what&apos;s left before members and coaches are ready to go.
          </p>
        </div>
        <ChevronRight size={18} className="text-ink-3 flex-none" />
      </Link>

      <h2 className="font-display text-[15px] font-semibold mt-7 mb-2.5">Academy</h2>
      <Link
        href="/owner/settings/locations"
        className="flex items-center gap-3 bg-paper border border-line rounded-ctl px-3.5 min-h-[56px] py-3 mb-2"
        data-testid="settings-locations"
      >
        <div className="h-9 w-9 rounded-[11px] grid place-items-center flex-none bg-water-soft text-water">
          <MapPin size={16} strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium leading-tight">
            {multiLocation ? "Locations" : "Academy location"}
          </p>
          <p className="mt-0.5 text-[12px] text-ink-3 leading-tight">
            {multiLocation
              ? "Every site, its address and its business hours."
              : "Address and business hours for your academy."}
          </p>
        </div>
        <ChevronRight size={18} className="text-ink-3 flex-none" />
      </Link>
      <Link
        href="/owner/announcements"
        className="flex items-center gap-3 bg-paper border border-line rounded-ctl px-3.5 min-h-[56px] py-3 mb-2"
        data-testid="settings-announcements"
      >
        <div className="h-9 w-9 rounded-[11px] grid place-items-center flex-none bg-water-soft text-water">
          <Megaphone size={16} strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium leading-tight">Announcements</p>
          <p className="mt-0.5 text-[12px] text-ink-3 leading-tight">
            Message staff, a batch or every guardian in-app.
          </p>
        </div>
        <ChevronRight size={18} className="text-ink-3 flex-none" />
      </Link>
      <Link
        href="/owner/settings/branding"
        className="flex items-center gap-3 bg-paper border border-line rounded-ctl px-3.5 min-h-[56px] py-3 mb-2"
      >
        <div className="h-9 w-9 rounded-[11px] grid place-items-center flex-none bg-water-soft text-water">
          <Palette size={16} strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium leading-tight">Branding</p>
          <p className="mt-0.5 text-[12px] text-ink-3 leading-tight">
            Display name, short name and accent.
          </p>
        </div>
        <ChevronRight size={18} className="text-ink-3 flex-none" />
      </Link>
      <Link
        href="/owner/settings/terminology"
        className="flex items-center gap-3 bg-paper border border-line rounded-ctl px-3.5 min-h-[56px] py-3 mb-2"
      >
        <div className="h-9 w-9 rounded-[11px] grid place-items-center flex-none bg-water-soft text-water">
          <Languages size={16} strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium leading-tight">Vocabulary</p>
          <p className="mt-0.5 text-[12px] text-ink-3 leading-tight">
            Eight overridable terms — &quot;member&quot; becomes &quot;swimmer&quot; and so on.
          </p>
        </div>
        <ChevronRight size={18} className="text-ink-3 flex-none" />
      </Link>
      <Link
        href="/owner/staff"
        className="flex items-center gap-3 bg-paper border border-line rounded-ctl px-3.5 min-h-[56px] py-3 mb-2"
      >
        <div className="h-9 w-9 rounded-[11px] grid place-items-center flex-none bg-water-soft text-water">
          <Users size={16} strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium leading-tight">Staff</p>
          <p className="mt-0.5 text-[12px] text-ink-3 leading-tight">
            Coaches, receptionists, workers and accountants. Invite from there.
          </p>
        </div>
        <ChevronRight size={18} className="text-ink-3 flex-none" />
      </Link>
      <Link
        href="/owner/settings/holidays"
        className="flex items-center gap-3 bg-paper border border-line rounded-ctl px-3.5 min-h-[56px] py-3 mb-2"
        data-testid="settings-holidays"
      >
        <div className="h-9 w-9 rounded-[11px] grid place-items-center flex-none bg-water-soft text-water">
          <CalendarOff size={16} strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium leading-tight">
            Holidays &amp; closures
          </p>
          <p className="mt-0.5 text-[12px] text-ink-3 leading-tight">
            Dates the session generator should skip.
          </p>
        </div>
        <ChevronRight size={18} className="text-ink-3 flex-none" />
      </Link>
      <Link
        href="/owner/settings/configuration"
        className="flex items-center gap-3 bg-paper border border-line rounded-ctl px-3.5 min-h-[56px] py-3 mb-2"
        data-testid="settings-configuration"
      >
        <div className="h-9 w-9 rounded-[11px] grid place-items-center flex-none bg-water-soft text-water">
          <SlidersHorizontal size={16} strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium leading-tight">
            Configuration
          </p>
          <p className="mt-0.5 text-[12px] text-ink-3 leading-tight">
            Every academy setting in one place, with change requests to the platform.
          </p>
        </div>
        <ChevronRight size={18} className="text-ink-3 flex-none" />
      </Link>
      <Link
        href="/owner/settings/activities"
        className="flex items-center gap-3 bg-paper border border-line rounded-ctl px-3.5 min-h-[56px] py-3 mb-2"
        data-testid="settings-activities"
      >
        <div className="h-9 w-9 rounded-[11px] grid place-items-center flex-none bg-water-soft text-water">
          <Dumbbell size={16} strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium leading-tight">
            Facilities &amp; activities
          </p>
          <p className="mt-0.5 text-[12px] text-ink-3 leading-tight">
            Pools, courts, tables and counters at each facility.
          </p>
        </div>
        <ChevronRight size={18} className="text-ink-3 flex-none" />
      </Link>
      {ladderEnabled ? (
        <Link
          href="/owner/settings/skills"
          className="flex items-center gap-3 bg-paper border border-line rounded-ctl px-3.5 min-h-[56px] py-3 mb-2"
          data-testid="settings-skills"
        >
          <div className="h-9 w-9 rounded-[11px] grid place-items-center flex-none bg-water-soft text-water">
            <Award size={16} strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium leading-tight">
              Skill ladder
            </p>
            <p className="mt-0.5 text-[12px] text-ink-3 leading-tight">
              Levels, skills and the four-band rubric coaches assess.
            </p>
          </div>
          <ChevronRight size={18} className="text-ink-3 flex-none" />
        </Link>
      ) : null}
      <Link
        href="/owner/settings/plans"
        className="flex items-center gap-3 bg-paper border border-line rounded-ctl px-3.5 min-h-[56px] py-3 mb-2"
        data-testid="settings-plans"
      >
        <div className="h-9 w-9 rounded-[11px] grid place-items-center flex-none bg-water-soft text-water">
          <CreditCard size={16} strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium leading-tight">
            Membership plans
          </p>
          <p className="mt-0.5 text-[12px] text-ink-3 leading-tight">
            Price the preset templates or add your own.
          </p>
        </div>
        <ChevronRight size={18} className="text-ink-3 flex-none" />
      </Link>
      <Link
        href="/owner/settings/payment-qrs"
        className="flex items-center gap-3 bg-paper border border-line rounded-ctl px-3.5 min-h-[56px] py-3 mb-2"
        data-testid="settings-payment-qrs"
      >
        <div className="h-9 w-9 rounded-[11px] grid place-items-center flex-none bg-water-soft text-water">
          <QrCode size={16} strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium leading-tight">
            Payment QRs
          </p>
          <p className="mt-0.5 text-[12px] text-ink-3 leading-tight">
            Collection QRs shown at reception.
          </p>
        </div>
        <ChevronRight size={18} className="text-ink-3 flex-none" />
      </Link>
      <Link
        href="/owner/settings/menu"
        className="flex items-center gap-3 bg-paper border border-line rounded-ctl px-3.5 min-h-[56px] py-3 mb-2"
        data-testid="settings-menu"
      >
        <div className="h-9 w-9 rounded-[11px] grid place-items-center flex-none bg-water-soft text-water">
          <Utensils size={16} strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium leading-tight">
            Café menu
          </p>
          <p className="mt-0.5 text-[12px] text-ink-3 leading-tight">
            Categories, items, prices and SAC codes the counter sells.
          </p>
        </div>
        <ChevronRight size={18} className="text-ink-3 flex-none" />
      </Link>
      <Link
        href="/owner/settings/alerts"
        className="flex items-center gap-3 bg-paper border border-line rounded-ctl px-3.5 min-h-[56px] py-3 mb-2"
        data-testid="settings-alerts"
      >
        <div className="h-9 w-9 rounded-[11px] grid place-items-center flex-none bg-water-soft text-water">
          <BellRing size={16} strokeWidth={2} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium leading-tight">
            Absence alerts
          </p>
          <p className="mt-0.5 text-[12px] text-ink-3 leading-tight">
            When coaches and parents should be told about missed sessions.
          </p>
        </div>
        <ChevronRight size={18} className="text-ink-3 flex-none" />
      </Link>

      <h2 className="font-display text-[15px] font-semibold mt-7 mb-2.5">Account</h2>
      <section className="rounded-card border border-line bg-paper p-4">
        <p className="font-display text-[14px] font-semibold">
          {identity?.fullName ?? "Signed in"}
        </p>
        <p className="mt-1 text-[13px] text-ink-3 font-mono">
          {identity?.phone ? formatPhoneIN(identity.phone) : "No phone on file"}
        </p>
      </section>
      <form action={logoutTenantAction} className="mt-3">
        <button
          type="submit"
          className="flex w-full items-center gap-2 rounded-card border border-line bg-paper px-4 py-3 text-[14px] font-medium text-ink hover:bg-paper/80"
        >
          <LogOut size={16} className="text-ink-3" />
          Sign out
        </button>
      </form>
    </main>
  );
}
