import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import type { ReactNode } from "react";
import { OwnerIcon, type OwnerIconName } from "@/components/owner-ui/owner-icon";

// Settings task surfaces (owner OpenPen management lane).
//
// The reference Settings page is ONE page of six task surfaces; each
// row is ONE labelled link that names a destination and says what it
// opens ("Open Academy profile"). The category metadata and the two
// surface shapes live here so the route file stays a thin composition
// and the deep-link (`?category=`) view renders the same objects.

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
      label: "Club",
      summary: "Your club profile, physical facilities, opening hours and closures.",
      items: [
        {
          href: "/owner/settings/academy",
          label: "Club profile & GST",
          detail: "Club name and billing identity for future invoices.",
        },
        {
          href: "/owner/settings/locations",
          label: flags.multiLocation ? "Physical facilities" : "Physical facility",
          detail: flags.multiLocation
            ? "Each physical site, its address and business hours."
            : "Your physical site’s address and business hours.",
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
      label: "Resources & programs",
      summary: "Sports resources, programs, levels and batches.",
      items: [
        {
          href: "/owner/settings/activities",
          label: "Sports resources",
          detail: "Courts, pools, tables and other resources at each physical facility.",
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
          detail: "Set resource slot prices by day and time before taking bookings.",
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
          // Named for what the owner changes there, not for the internal
          // route: the theme preset and the artwork.
          label: "Theme & artwork",
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
 * The Owner Settings category headings draw the shared OUTLINE Owner glyph
 * (Foundation owns the geometry: the approved mock's own outline paths, drawn
 * with fill=none, stroke=currentColor, stroke-width 1.8, round caps and joins).
 *
 * 2 November 2026: the 184-view Chrome review found these headings still
 * drawing the filled/duotone Khel family. The mapping is explicit — a category
 * is a PLACE, and the outline pack names places, not concepts:
 *
 *   academy        → pin        (the academy's own location)
 *   programs       → programs   (the programme list)
 *   fees           → money      (plans, prices and payments)
 *   team           → staff      (the people who work here)
 *   communications → bell       (alerts and announcements)
 *   appearance     → settings   (display preferences)
 *
 * The glyph is a CUE beside the task's own words — the words carry the
 * meaning, and the glyph never stands alone. This module is Owner-only, with
 * the Owner Settings page as its single consumer; no other role's surface, no
 * global file and no other icon family is touched.
 */
const CATEGORY_ICON: Record<string, OwnerIconName> = {
  academy: "pin",
  programs: "programs",
  fees: "money",
  team: "staff",
  communications: "bell",
  appearance: "settings",
};

export function categoryIcon(key: string): OwnerIconName | undefined {
  return CATEGORY_ICON[key];
}

/**
 * One destination is ONE labelled link.
 *
 * 3 November 2026: the row used to be a non-clickable name beside a
 * separate bordered "Open" mini-button, so a single destination painted
 * two controls and the actual Chrome screenshot of the Owner Settings page
 * showed 20+ repeated "Open" buttons. The approved mock draws ONE control
 * per row — the row carries the name, the optional detail and the outline
 * chevron (khelsuite-owner-light-type-mock.html, `viewSettings()`).
 *
 * What is preserved on purpose:
 *   - the authored href of every destination;
 *   - the optional test id of a destination;
 *   - the feature and permission gates that decide whether a destination
 *     exists at all (they live in `settingCategories()`, not here);
 *   - the accessible name "Open <name>", so the row still says what it
 *     opens and the existing screen-reader expectations still resolve;
 *   - the optional detail, still omitted when the surface hides it.
 *
 * The chevron is the shared OUTLINE Owner glyph (Foundation owns the
 * geometry), decorative by default, and the row carries a 44px target with
 * a visible hover and focus state.
 */
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
        <li key={item.href} className="border-b border-line last:border-0">
          <Link
            href={item.href}
            data-testid={item.testId}
            aria-label={`Open ${item.label}`}
            className="group flex min-h-11 items-center justify-between gap-3 rounded-ctl py-2 hover:bg-deck focus-visible:outline-solid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus-ring)]"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-medium leading-snug text-ink">
                {item.label}
              </span>
              {hideDetail ? null : (
                <span className="mt-0.5 block text-[12px] leading-snug text-ink-3">
                  {item.detail}
                </span>
              )}
            </span>
            <OwnerIcon
              name="chevron"
              size={18}
              className="flex-none text-ink-3 transition-colors group-hover:text-ink-2"
            />
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
  icon?: OwnerIconName;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 rounded-card border border-line bg-paper p-4 sm:p-5">
      <h2 className="flex items-center gap-2 font-display text-[16px] font-semibold text-ink">
        {icon ? (
          <OwnerIcon name={icon} size={20} className="flex-none" />
        ) : null}
        {title}
      </h2>
      {children}
    </section>
  );
}
