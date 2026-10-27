import Link from "next/link";
import {
  Award,
  BellRing,
  Building2,
  CalendarOff,
  ChevronRight,
  ClipboardList,
  CreditCard,
  Dumbbell,
  Languages,
  ListChecks,
  MapPin,
  Megaphone,
  Palette,
  QrCode,
  Receipt,
  SlidersHorizontal,
  Users,
  Utensils,
} from "lucide-react";
import { getCurrentStaffIdentity } from "@/lib/services/staff";
import { getOnboardingChecklistAction } from "@/lib/actions/onboarding-checklist";
import { TenantSignOut } from "@/components/tenant-sign-out";
import { listAdminLocationsAction } from "@/lib/actions/locations";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { formatPhoneIN } from "@/lib/phone";
import CalendarDays from "lucide-react/dist/esm/icons/calendar-days.mjs";

// Owner UX audit (2026-10-24): Settings was fourteen equal-weight
// links under one heading, with Configuration and the specialist
// settings overlapping the groups above them. The owner had to read
// fourteen rows to find opening hours.
//
// Settings is now a compact list of SIX categories, each with a
// one-line summary, and opening a category shows only that category's
// destinations. Every destination below is the EXISTING canonical edit
// screen — no setting is re-implemented here, and nothing is exposed
// that the academy does not actually support.
//
// F-23 — branding, terminology, staff and the onboarding checklist live
// here. U-07 adds the locations + business-hours editor; the label
// stays singular for a single-site tenant so the concept of multiple
// locations never appears until one exists.
// K2 — the Account block at the foot of the page: the bottom nav's 4th
// slot is Settings (admin-y), not a "Me" tab, so the identity block
// + sign-out lives here instead.

type SettingItem = {
  href: string;
  label: string;
  detail: string;
  icon: typeof MapPin;
  testId?: string;
};

type SettingCategory = {
  key: string;
  label: string;
  summary: string;
  items: SettingItem[];
};

// The category map. The order is the order an owner thinks in: what
// the academy IS, what it TEACHES, what it COSTS, who WORKS there,
// what it SAYS, and how it LOOKS.
//
// Two entries are gated at runtime, because the academy decides them:
// the skill ladder is only offered when the module is on (V-09), and a
// single-site tenant never sees the concept of multiple locations
// (U-07).
function categories(flags: {
  ladderEnabled: boolean;
  multiLocation: boolean;
  canReadBookings: boolean;
}): SettingCategory[] {
  return [
  {
    key: "academy",
    label: "Academy",
    summary: "Your profile, your sites, opening hours and closures.",
    items: [
      {
        href: "/owner/settings/academy",
        label: "Academy profile",
        detail: "Name, currency, time zone and GSTIN for invoices.",
        icon: Building2,
      },
      {
        href: "/owner/settings/locations",
        label: flags.multiLocation ? "Locations" : "Academy location",
        detail: flags.multiLocation
          ? "Every site, its address and its business hours."
          : "Address and business hours for your academy.",
        icon: MapPin,
        testId: "settings-locations",
      },
      {
        href: "/owner/settings/holidays",
        label: "Holidays & closures",
        detail: "Days the academy is closed, so no sessions are scheduled.",
        icon: CalendarOff,
      },
    ],
  },
  {
    key: "programs",
    label: "Programs & facilities",
    summary: "What you teach, the levels, and the batches you run.",
    items: [
      {
        href: "/owner/settings/activities",
        label: "Activities",
        detail: "The sports and activities this academy offers.",
        icon: Dumbbell,
      },
      ...(flags.ladderEnabled
        ? [
            {
              href: "/owner/settings/skills",
              label: "Skill ladder",
              detail: "The levels swimmers move through, and their rubrics.",
              icon: Award,
            },
          ]
        : []),
      {
        href: "/owner/programs",
        label: "Programs & batches",
        detail: "Create the programs you run and the batches inside them.",
        icon: ClipboardList,
      },
      // The booking desk is only offered to a caller who can actually
      // open it: the route needs bookings.read and the pool.booking
      // entitlement, and it 404s for anyone else. A hidden link is not
      // security — the route guard stays authoritative.
      ...(flags.canReadBookings
        ? [
            {
              href: "/owner/bookings",
              label: "Bookings",
              detail: "Book a facility slot and manage the day's bookings.",
              icon: CalendarDays,
            },
          ]
        : []),
    ],
  },
  {
    key: "fees",
    label: "Fees & payments",
    summary: "What you charge, how you take it, and what the counter sells.",
    items: [
      {
        href: "/owner/settings/plans",
        label: "Membership plans",
        detail: "The priced plans a member can subscribe to.",
        icon: CreditCard,
      },
      // The price catalogue sits under this page's own settings.manage
      // authority, which is exactly the authority its destination needs.
      {
        href: "/owner/settings/booking-prices",
        label: "Booking prices",
        detail: "Set facility slot prices before taking bookings.",
        icon: Receipt,
      },
      {
        href: "/owner/settings/payment-qrs",
        label: "Payment QR codes",
        detail: "The QR a parent scans to pay.",
        icon: QrCode,
      },
      {
        href: "/owner/settings/menu",
        label: "Café menu",
        detail: "What the counter sells, and what it costs.",
        icon: Utensils,
      },
    ],
  },
  {
    key: "team",
    label: "Team & access",
    summary: "Who works here, and what each of them can do.",
    items: [
      {
        href: "/owner/staff",
        label: "Staff",
        detail: "Coaches, reception and the access each role has.",
        icon: Users,
      },
    ],
  },
  {
    key: "communications",
    label: "Communications",
    summary: "Who gets told what, and when.",
    items: [
      {
        href: "/owner/settings/alerts",
        label: "Absence alerts",
        detail: "When coaches and parents should be told about missed sessions.",
        icon: BellRing,
      },
      {
        href: "/owner/announcements",
        label: "Announcements",
        detail: "Write and send a message to members and guardians.",
        icon: Megaphone,
      },
    ],
  },
  {
    key: "appearance",
    label: "Appearance & advanced",
    summary: "Branding, the words you use, and platform-level changes.",
    items: [
      {
        href: "/owner/settings/branding",
        label: "Branding",
        detail: "Your name, mark and accent colour.",
        icon: Palette,
      },
      {
        href: "/owner/settings/terminology",
        label: "Vocabulary",
        detail: "What you call members, sessions and facilities.",
        icon: Languages,
      },
      {
        href: "/owner/settings/configuration",
        label: "Configuration requests",
        detail: "Ask the platform to change a setting it owns.",
        icon: SlidersHorizontal,
      },
    ],
  },
  ];
}

export default async function Page({
  searchParams,
}: {
  searchParams?: Promise<{ category?: string }>;
}) {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "settings.manage");

  const params = searchParams ? await searchParams : {};

  // V-09 — the ladder editor is only offered when the module is on.
  const ladderEnabled = ctx.features.has("swim.levels");
  const identity = await getCurrentStaffIdentity(ctx);
  // U-07 — a single-location tenant never sees the concept of multiple
  // sites: the label stays singular until a second location exists.
  // The page itself is still reachable, because adding that second
  // location is the only way the concept ever becomes real.
  const locations = await listAdminLocationsAction();
  const multiLocation = locations.length > 1;
  // W1-6 continuation — the checklist is a first-run aid, so it is
  // gone from every owner surface once complete: no dashboard tile,
  // no Settings row. The /owner/onboarding page stays live for anyone
  // who types the URL or is sent there by support.
  const checklist = await getOnboardingChecklistAction().catch(() => null);
  const setupComplete = checklist ? checklist.items.every((item) => item.complete) : false;

  const CATEGORIES = categories({
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
    <main className="px-5 pt-6 pb-8 max-w-2xl">
      {active ? (
        <Link
          href="/owner/settings"
          className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ink-2"
        >
          <ChevronRight size={14} className="rotate-180 text-ink-3" aria-hidden="true" />
          Settings
        </Link>
      ) : null}

      <h1 className="font-display text-[19px] font-semibold mt-2">
        {active ? active.label : "Settings"}
      </h1>
      <p className="mt-1.5 text-[13px] text-ink-3">
        {active
          ? active.summary
          : setupComplete
            ? "Everything you can change about the academy, grouped by what you are doing."
            : "Everything you can change about the academy, grouped by what you are doing."}
      </p>

      {!setupComplete ? (
        <>
          <h2 className="font-display text-[15px] font-semibold mt-7 mb-2.5">Setup</h2>
          <Link
            href="/owner/onboarding"
            className="flex items-center gap-3 bg-paper border border-line rounded-ctl px-3.5 min-h-[56px] py-3 mb-2"
            data-testid="settings-onboarding"
          >
            <div className="h-9 w-9 rounded-[11px] grid place-items-center flex-none bg-warn-soft text-warn">
              <ListChecks size={16} strokeWidth={2} />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-medium leading-tight">
                Onboarding checklist
              </p>
              <p className="mt-0.5 text-[12px] text-ink-3 leading-tight">
                See what&apos;s left before members and coaches are ready to go.
              </p>
            </div>
            <ChevronRight size={18} className="text-ink-3 flex-none" />
          </Link>
        </>
      ) : null}

      {active ? (
        // One category at a time — the audit's "open one category at a
        // time, rather than showing every form together".
        <ul className="mt-5">
          {active.items.map((item) => (
            <li key={item.href} className="mb-2">
              <Link
                href={item.href}
                className="flex items-center gap-3 bg-paper border border-line rounded-ctl px-3.5 min-h-[56px] py-3"
                data-testid={item.testId}
              >
                <div className="h-9 w-9 rounded-[11px] grid place-items-center flex-none bg-water-soft text-water">
                  <item.icon size={16} strokeWidth={2} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium leading-tight">{item.label}</p>
                  <p className="mt-0.5 text-[12px] text-ink-3 leading-tight">{item.detail}</p>
                </div>
                <ChevronRight size={18} className="text-ink-3 flex-none" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="mt-5">
          {CATEGORIES.map((category) => (
            <li key={category.key} className="mb-2">
              <Link
                href={`/owner/settings?category=${category.key}`}
                className="flex items-center gap-3 bg-paper border border-line rounded-ctl px-3.5 min-h-[56px] py-3"
                data-testid={`settings-category-${category.key}`}
              >
                <div className="h-9 w-9 rounded-[11px] grid place-items-center flex-none bg-water-soft text-water">
                  {category.key === "academy" ? (
                    <Building2 size={16} strokeWidth={2} />
                  ) : category.key === "programs" ? (
                    <ClipboardList size={16} strokeWidth={2} />
                  ) : category.key === "fees" ? (
                    <Receipt size={16} strokeWidth={2} />
                  ) : category.key === "team" ? (
                    <Users size={16} strokeWidth={2} />
                  ) : category.key === "communications" ? (
                    <Megaphone size={16} strokeWidth={2} />
                  ) : (
                    <Palette size={16} strokeWidth={2} />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-medium leading-tight">{category.label}</p>
                  <p className="mt-0.5 text-[12px] text-ink-3 leading-tight">{category.summary}</p>
                </div>
                <ChevronRight size={18} className="text-ink-3 flex-none" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <h2 className="font-display text-[15px] font-semibold mt-7 mb-2.5">Account</h2>
      <section className="rounded-card border border-line bg-paper p-4">
        <p className="font-display text-[14px] font-semibold">
          {identity?.fullName ?? "Signed in"}
        </p>
        <p className="mt-1 text-[13px] text-ink-3 font-mono">
          {identity?.phone ? formatPhoneIN(identity.phone) : "No phone on file"}
        </p>
      </section>
      <TenantSignOut className="mt-3" />
    </main>
  );
}
