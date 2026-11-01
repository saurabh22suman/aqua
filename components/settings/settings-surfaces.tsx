import Link from "next/link";
import type { ReactNode } from "react";
import { KhelIcon, type KhelIconName } from "@/components/icons/khel-icons";

// Settings task surfaces (owner OpenPen management lane).
//
// The reference Settings page is ONE page of six task surfaces; each
// row names a destination and offers a single "Open" action. The
// category metadata and the two surface shapes live here so the route
// file stays a thin composition and the deep-link (`?category=`) view
// renders the same objects.

export type SettingItem = {
  href: string;
  label: string;
  detail: string;
  testId?: string;
};

export type SettingCategory = {
  key: string;
  label: string;
  summary: string;
  items: SettingItem[];
};

export type SettingFlags = {
  ladderEnabled: boolean;
  multiLocation: boolean;
  canReadBookings: boolean;
};

export function settingCategories(flags: SettingFlags): SettingCategory[] {
  return [
    {
      key: "academy",
      label: "Academy",
      summary: "Your academy profile, sites, opening hours and closures.",
      items: [
        {
          href: "/owner/settings/academy",
          label: "Academy profile",
          detail: "Academy name and billing identity for future invoices.",
        },
        {
          href: "/owner/settings/locations",
          label: flags.multiLocation ? "Locations" : "Academy location",
          detail: flags.multiLocation
            ? "Every site, its address and its business hours."
            : "Address and business hours for your academy.",
          testId: "settings-locations",
        },
        {
          href: "/owner/settings/holidays",
          label: "Holidays & closures",
          detail: "Days the academy is closed, so no sessions are scheduled.",
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
          label: "Activities & resources",
          detail: "The sports, courts, pools and counters this academy runs.",
        },
        ...(flags.ladderEnabled
          ? [
              {
                href: "/owner/settings/skills",
                label: "Skill ladder",
                detail: "The levels swimmers move through, and their rubrics.",
              },
            ]
          : []),
        {
          href: "/owner/programs",
          label: "Programs & batches",
          detail: "Create the programs you run and the batches inside them.",
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
        },
        // The price catalogue sits under this page's own settings.manage
        // authority, which is exactly the authority its destination needs.
        {
          href: "/owner/settings/booking-prices",
          label: "Booking prices",
          detail: "Set facility slot prices before taking bookings.",
        },
        {
          href: "/owner/settings/payment-qrs",
          label: "Payment QR codes",
          detail: "The QR a parent scans to pay.",
        },
        {
          href: "/owner/settings/menu",
          label: "Café menu",
          detail: "What the counter sells, and what it costs.",
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
        },
        {
          href: "/owner/staff/invitations",
          label: "Invitations",
          detail: "Login invites, their role and their location scope.",
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
        },
        {
          href: "/owner/announcements",
          label: "Announcements",
          detail: "Write and send a message to members and guardians.",
        },
      ],
    },
    {
      key: "appearance",
      label: "Appearance & advanced",
      summary: "Your display preferences, club branding and academy rules.",
      items: [
        {
          href: "/owner/settings/appearance",
          label: "Appearance",
          detail: "Your personal theme and artwork preferences.",
        },
        {
          href: "/owner/settings/reports",
          label: "Report preferences",
          detail: "Your personal report display preferences.",
        },
        {
          href: "/owner/settings/branding",
          label: "Club branding",
          detail: "Your name, mark and accent colour.",
        },
        {
          href: "/owner/settings/terminology",
          label: "Vocabulary",
          detail: "What you call members, sessions and facilities.",
        },
        {
          href: "/owner/settings/configuration",
          label: "Academy rules",
          detail: "Effective values and requests for platform-held settings.",
        },
      ],
    },
  ];
}

/**
 * The reviewed icon family carries one glyph per task surface. The
 * glyph is a CUE beside the task's own words — the words carry the
 * meaning, and the glyph never stands alone.
 */
const CATEGORY_ICON: Record<string, KhelIconName> = {
  academy: "facilities",
  programs: "programs",
  fees: "fees",
  team: "staff",
  communications: "announcements",
  appearance: "settings",
};

export function categoryIcon(key: string): KhelIconName | undefined {
  return CATEGORY_ICON[key];
}

export function SettingsSurfaceItems({
  items,
  hideDetail = false,
}: {
  items: SettingItem[];
  hideDetail?: boolean;
}) {
  return (
    <ul className="mt-1">
      {items.map((item) => (
        <li
          key={item.href}
          className="flex items-center justify-between gap-3 border-b border-line py-2 last:border-0"
        >
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium leading-snug text-ink">
              {item.label}
            </p>
            {hideDetail ? null : (
              <p className="mt-0.5 text-[12px] leading-snug text-ink-3">
                {item.detail}
              </p>
            )}
          </div>
          <Link
            href={item.href}
            data-testid={item.testId}
            aria-label={`Open ${item.label}`}
            className="inline-flex min-h-11 flex-none items-center justify-center rounded-ctl border border-line px-3 text-[13px] font-medium text-ink hover:bg-deck"
          >
            Open
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function SettingsTaskSurface({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: KhelIconName;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-card border border-line bg-paper p-4 sm:p-5">
      <h2 className="flex items-center gap-2 font-display text-[16px] font-semibold text-ink">
        {icon ? (
          <KhelIcon name={icon} size={20} className="flex-none" />
        ) : null}
        {title}
      </h2>
      {children}
    </section>
  );
}
