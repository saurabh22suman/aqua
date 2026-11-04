import type { ReactNode } from "react";

// Owner icon — FOUNDATION lane, 2 November 2026.
//
// The shared typed outline icon set for the Owner product.
//
// The human rejected the icon pack in the baseline screenshot (work/
// owner-light-implementation-20261102/ICON-ADDENDUM.md): the Owner
// surfaces must draw the APPROVED MOCK's own outline geometry, exactly.
//
// The geometry below is the mock's `var ICONS` map copied as static
// React SVG children
// (outputs/owner-mock-20261102/khelsuite-owner-light-type-mock.html,
// lines 646–672). There is no new npm dependency, no
// dangerouslySetInnerHTML, no raw SVG string, no script and no remote
// fetch: the children are typed React elements.
//
// The drawing contract (one box, one stroke):
//
//   viewBox 0 0 24 24 · fill none · stroke currentColor
//   strokeWidth 1.8 · round caps and joins · decorative by default
//
// The SELECTED state is a colour, never a different or heavier glyph:
// the same outline geometry is drawn in the theme's accent.
//
// RED PROVENANCE: this file was first written as the smallest
// importable shell (a 24×24 outline box with no geometry) so that
// owner-icon.test.tsx and owner-nav-icon-geometry.test.tsx could fail on
// the INTENDED geometry — not on a missing module. The failing run is
// recorded in the lane handoff.

export type OwnerIconName =
  | "home"
  | "members"
  | "calendar"
  | "more"
  | "invoice"
  | "booking"
  | "programs"
  | "enquiry"
  | "staff"
  | "reports"
  | "settings"
  | "money"
  | "userplus"
  | "alert"
  | "search"
  | "check"
  | "chevron"
  | "down"
  | "left"
  | "bell"
  | "wifi"
  | "lock"
  | "pin"
  | "plus"
  | "info";

const GEOMETRY: Record<OwnerIconName, ReactNode> = {
  home: (
    <path d="M3.5 10.7 12 3.9l8.5 6.8V20a1 1 0 0 1-1 1h-4.6v-5.6h-5.8V21H4.5a1 1 0 0 1-1-1z" />
  ),
  members: (
    <>
      <circle cx="9.5" cy="8" r="3.4" />
      <path d="M3.5 19.5v-1a4.4 4.4 0 0 1 4.4-4.4h3.2a4.4 4.4 0 0 1 4.4 4.4v1" />
      <path d="M17 5.2a3.4 3.4 0 0 1 0 6.6" />
      <path d="M20.5 19.5v-1a4.4 4.4 0 0 0-2.6-4" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5.5" width="17" height="15" rx="2" />
      <path d="M8 3.5v4M16 3.5v4M3.5 10h17" />
    </>
  ),
  more: (
    <>
      <circle cx="6" cy="12" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="18" cy="12" r="1.6" />
    </>
  ),
  invoice: (
    <>
      <path d="M6 3.5h8l4 4v13H6z" />
      <path d="M14 3.5v4h4" />
      <path d="M9 12h6M9 16h4" />
    </>
  ),
  booking: (
    <>
      <rect x="3.5" y="5.5" width="17" height="15" rx="2" />
      <path d="M8 3.5v4M16 3.5v4M9 13.5l2 2 4-4" />
    </>
  ),
  programs: (
    <>
      <path d="M4 6.5h16M4 12h16M4 17.5h10" />
      <circle cx="18.5" cy="17.5" r="2" />
    </>
  ),
  enquiry: <path d="M4 5.5h16v11H9l-5 4z" />,
  staff: (
    <>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5 20v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1" />
    </>
  ),
  reports: (
    <>
      <path d="M4 20h16" />
      <path d="M6.5 20V11M12 20V5.5M17.5 20v-6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18" />
    </>
  ),
  money: (
    <>
      <rect x="3.5" y="6" width="17" height="12" rx="2" />
      <path d="M3.5 10.5h17" />
      <path d="M7 14.5h4" />
    </>
  ),
  userplus: (
    <>
      <circle cx="10" cy="8" r="3.4" />
      <path d="M3.8 20v-1.2a5 5 0 0 1 5-5h2.4a5 5 0 0 1 5 5V20" />
      <path d="M18.5 8v6M15.5 11h6" />
    </>
  ),
  alert: (
    <>
      <path d="M12 4.5 21 19.5H3z" />
      <path d="M12 10v4.5M12 17h.01" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="m15.5 15.5 4 4" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  down: <path d="m6 9 6 6 6-6" />,
  left: <path d="m15 5-7 7 7 7" />,
  bell: (
    <>
      <path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 4 1.5 5.5 1.5 5.5H5S6.5 14 6.5 10" />
      <path d="M10 18.5a2 2 0 0 0 4 0" />
    </>
  ),
  wifi: (
    <>
      <path d="M2.5 9a15 15 0 0 1 19 0" />
      <path d="M6 12.5a10 10 0 0 1 12 0" />
      <path d="M9.5 16a5 5 0 0 1 5 0" />
      <path d="M12 19.5h.01" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21s6.5-6.1 6.5-10.5a6.5 6.5 0 0 0-13 0C5.5 14.9 12 21 12 21" />
      <circle cx="12" cy="10.3" r="2.4" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.6" />
      <path d="M12 11.3v5.1M12 7.9h.01" />
    </>
  ),
};

export type OwnerIconProps = {
  /** The icon. The name is the only way in — there is no raw SVG. */
  name: OwnerIconName;
  /** The drawn size in pixels. The viewBox is always 24×24. */
  size?: number;
  /** Extra classes from the caller. */
  className?: string;
  /** A standalone accessible name. Omit it when a label sits beside it. */
  title?: string;
};

export function OwnerIcon({
  name,
  size = 20,
  className,
  title,
}: OwnerIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      className={className}
    >
      {title ? <title>{title}</title> : null}
      {GEOMETRY[name]}
    </svg>
  );
}
