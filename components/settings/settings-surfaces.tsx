import Link from "next/link";
import type { ReactNode } from "react";
import Building2 from "lucide-react/dist/esm/icons/building-2.mjs";
import ClipboardList from "lucide-react/dist/esm/icons/clipboard-list.mjs";
import MapPin from "lucide-react/dist/esm/icons/map-pin.mjs";
import Megaphone from "lucide-react/dist/esm/icons/megaphone.mjs";
import Palette from "lucide-react/dist/esm/icons/palette.mjs";
import Receipt from "lucide-react/dist/esm/icons/receipt.mjs";
import Users from "lucide-react/dist/esm/icons/users.mjs";

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
      summary: "Branding, the words you use, and platform-level changes.",
      items: [
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

const CATEGORY_ICON: Record<string, typeof MapPin> = {
  academy: Building2,
  programs: ClipboardList,
  fees: Receipt,
  team: Users,
  communications: Megaphone,
  appearance: Palette,
};

export function categoryIcon(key: string): typeof MapPin | undefined {
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
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line py-3 last:border-0"
        >
          <div className="min-w-0">
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
            className="inline-flex min-h-11 flex-none items-center text-[13px] font-medium text-[var(--accent-ink)] underline underline-offset-2 hover:text-ink"
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
  icon: Icon,
  children,
}: {
  title: string;
  icon?: typeof MapPin;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-card border border-line bg-paper p-5">
      <h2 className="flex items-center gap-2 font-display text-[16px] font-semibold text-ink">
        {Icon ? (
          <Icon
            size={17}
            strokeWidth={1.8}
            className="flex-none text-ink-3"
            aria-hidden="true"
          />
        ) : null}
        {title}
      </h2>
      {children}
    </section>
  );
}
