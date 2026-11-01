import type { CSSProperties, ReactNode } from "react";

// The reviewed icon family (Dot's original revision-1 glyphs).
//
// PROVENANCE. The geometry in this file is copied verbatim from the
// reviewed asset set, which is kept IN the repository at:
//   docs/design-system/icons/quiet24/svg/
// — sixteen transparent plain SVG glyphs on one 24×24 grid, authored
// for this task and reviewed as contact sheets in BOTH themes (the
// revision-1 `programs` glyph is the revised rising-steps + arrow).
// The provenance of that set — original task, the supplied revision-1
// archive SHA-256, the 4963-byte size and the repository copy's
// fingerprint — is recorded in
// `docs/design-system/icons/quiet24/README.md`.
//
// The files are XML-parsed and safe-element allowlisted: no scripts,
// no event handlers, no ids, no references, no bitmaps, no labels and
// no fonts. The geometry is reproduced here as static typed React —
// there is no raw HTML injection, no dependency, no remote fetch and
// no asset pipeline. The SVGs in the repository are REVIEW SOURCES,
// not runtime assets: nothing loads them.
//
// THE TWO TONE SLOTS. These are DUOTONE glyphs, and the two slots are
// a DELIBERATE PAIR that cannot collapse:
//
//   primary   var(--icon-primary, var(--color-ink-2))
//   secondary var(--icon-secondary, var(--color-ink-3))
//
// Both defaults are theme tokens — never a study hex — and they are
// different tokens, so the contained interior detail the geometry
// depends on (the enquiry dots, the fee detail, the member group)
// always survives. The primary is PINNED to the ink-2 token rather
// than to `currentColor`, because a consumer whose text colour happened
// to be the secondary token would collapse the two slots into one
// colour and the detail would disappear. A consumer that needs the
// context colour — a glyph on a dark surface — sets
// `--icon-primary: currentColor` (or a light token) on the element.
//
// A consumer may re-tone either slot by setting `--icon-primary` or
// `--icon-secondary` on the glyph.
//
// SIZE AND ACCESSIBILITY. The glyph is a GLYPH, not a hit area: the
// control around it owns the 44/48px target. It is decorative by
// default (`aria-hidden`), so a labelled button never reads its icon
// twice; an unfamiliar glyph that stands alone is given a `title`,
// which makes the SVG an image with that accessible name.
//
// The family is used on TASK and MODULE surfaces. It is not a
// complete role navigation set — no Home or Profile glyph exists, and
// none is invented — so the role navigation keeps the icon set it has.

/** The secondary tone: a theme token, distinct from the primary slot. */
const SECONDARY = "var(--icon-secondary, var(--color-ink-3))";

/** The primary tone: a theme token, distinct from the secondary slot. */
const PRIMARY = "var(--icon-primary, var(--color-ink-2))";

export type KhelIconName =
  | "announcements"
  | "attendance"
  | "audit-activity"
  | "bookings"
  | "cafe"
  | "collect-payment"
  | "enquiries"
  | "facilities"
  | "fees"
  | "members"
  | "programs"
  | "reports"
  | "schedule"
  | "settings"
  | "staff"
  | "tenants";

/** The glyph sizes the family is drawn for. */
export type KhelIconSize = 16 | 20 | 24 | 32;

const GLYPHS: Record<KhelIconName, ReactNode> = {
  announcements: (
    <>
      <path fill={SECONDARY} d="m4 8 15-5v16L4 14H2V8Z" />
      <path d="M6 15h4l2 7H8Z" />
      <rect x="20" y="8" width="3" height="6" rx="1.5" />
    </>
  ),
  attendance: (
    <>
      <path
        fill={SECONDARY}
        d="M6 3h12a3 3 0 0 1 3 3v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a3 3 0 0 1 3-3Z"
      />
      <rect x="8" y="1" width="8" height="5" rx="2" />
      <path d="m7 13 3 3 7-7 2 2-9 9-5-5Z" />
    </>
  ),
  "audit-activity": (
    <>
      <rect fill={SECONDARY} x="3" y="2" width="18" height="20" rx="3" />
      <circle cx="7" cy="7" r="1.5" />
      <circle cx="7" cy="12" r="1.5" />
      <circle cx="7" cy="17" r="1.5" />
      <rect x="11" y="6" width="7" height="2" rx="1" />
      <rect x="11" y="11" width="5" height="2" rx="1" />
      <rect x="11" y="16" width="7" height="2" rx="1" />
    </>
  ),
  bookings: (
    <>
      <rect fill={SECONDARY} x="2" y="4" width="20" height="18" rx="3" />
      <rect x="2" y="8" width="20" height="3" rx="1" />
      <rect x="6" y="1" width="3" height="6" rx="1.5" />
      <rect x="15" y="1" width="3" height="6" rx="1.5" />
      <path d="M9 13h6v8l-3-2-3 2Z" />
    </>
  ),
  cafe: (
    <>
      <path
        fillRule="evenodd"
        d="M16 7h3a4 4 0 0 1 0 8h-3v-3h3a1 1 0 0 0 0-2h-3Z"
      />
      <path fill={SECONDARY} d="M3 6h14v7a7 7 0 0 1-14 0Z" />
      <rect x="2" y="21" width="18" height="2" rx="1" />
      <rect x="6" y="1" width="3" height="4" rx="1.5" />
      <rect x="12" y="1" width="3" height="4" rx="1.5" />
    </>
  ),
  "collect-payment": (
    <>
      <rect fill={SECONDARY} x="2" y="4" width="16" height="14" rx="3" />
      <rect x="2" y="7" width="16" height="3" rx="1" />
      <path d="M17 12h3v3h3v3h-3v3h-3v-3h-3v-3h3Z" />
      <rect x="5" y="13" width="5" height="2" rx="1" />
    </>
  ),
  enquiries: (
    <>
      <path
        fill={SECONDARY}
        d="M5 3h14a3 3 0 0 1 3 3v11a3 3 0 0 1-3 3H9l-6 3v-4a3 3 0 0 1-1-2V6a3 3 0 0 1 3-3Z"
      />
      <circle cx="7" cy="11" r="1.5" />
      <circle cx="12" cy="11" r="1.5" />
      <circle cx="17" cy="11" r="1.5" />
    </>
  ),
  facilities: (
    <>
      <rect fill={SECONDARY} x="2" y="4" width="20" height="16" rx="3" />
      <path
        fillRule="evenodd"
        d="M4 6h16v12H4Zm2 2v8h4.5V8Zm7.5 0v8H18V8Z"
      />
    </>
  ),
  fees: (
    <>
      <path
        fill={SECONDARY}
        d="M5 2h14a2 2 0 0 1 2 2v17l-3-2-3 2-3-2-3 2-3-2-3 2V4a2 2 0 0 1 2-2Z"
      />
      <rect x="7" y="6" width="10" height="2.5" rx="1.25" />
      <rect x="7" y="11" width="6" height="2.5" rx="1.25" />
      <circle cx="17" cy="14.5" r="2" />
    </>
  ),
  members: (
    <>
      <circle cx="9" cy="7" r="3" />
      <path d="M2 19v-2a7 7 0 0 1 14 0v2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2Z" />
      <g fill={SECONDARY}>
        <circle cx="18" cy="8" r="2.5" />
        <path d="M17 13a5 5 0 0 1 5 5v1a2 2 0 0 1-2 2h-3v-4a9 9 0 0 0-1-4Z" />
      </g>
    </>
  ),
  programs: (
    <>
      <path
        fill={SECONDARY}
        d="M3 16h5v-5h6V6h6a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1Z"
      />
      <path d="M3 10 10 3H7V1h6a1 1 0 0 1 1 1v6h-2V5l-7 7a1.4 1.4 0 0 1-2-2Z" />
    </>
  ),
  reports: (
    <>
      <rect fill={SECONDARY} x="2" y="2" width="20" height="20" rx="4" />
      <rect x="5" y="13" width="3" height="6" rx="1.5" />
      <rect x="10.5" y="9" width="3" height="10" rx="1.5" />
      <rect x="16" y="5" width="3" height="14" rx="1.5" />
    </>
  ),
  schedule: (
    <>
      <circle fill={SECONDARY} cx="12" cy="12" r="10" />
      <path d="M10.5 5h3v6.3l4.5 2.6-1.5 2.6-6-3.5Z" />
    </>
  ),
  settings: (
    <>
      <rect fill={SECONDARY} x="2" y="2" width="20" height="20" rx="4" />
      <path d="M5 7h14v2H5Zm0 8h14v2H5Z" />
      <rect x="8" y="4" width="4" height="8" rx="2" />
      <rect x="14" y="12" width="4" height="8" rx="2" />
    </>
  ),
  staff: (
    <>
      <rect fill={SECONDARY} x="3" y="4" width="18" height="18" rx="3" />
      <rect x="9" y="1" width="6" height="6" rx="2" />
      <circle cx="12" cy="11" r="2.5" />
      <path d="M7 19a5 5 0 0 1 10 0Z" />
    </>
  ),
  tenants: (
    <>
      <rect fill={SECONDARY} x="2" y="2" width="8" height="20" rx="2" />
      <rect fill={SECONDARY} x="13" y="7" width="9" height="15" rx="2" />
      <path d="M4 5h4v3H4Zm0 6h4v3H4Zm11-1h5v3h-5Zm0 6h5v3h-5ZM4 17h4v5H4Z" />
    </>
  ),
};

/** Every glyph the family carries. */
export const KHEL_ICON_NAMES = Object.keys(GLYPHS) as KhelIconName[];

export type KhelIconProps = {
  /** Which glyph. */
  name: KhelIconName;
  /** The drawn size in pixels. The glyph is not the hit area. */
  size?: KhelIconSize;
  className?: string;
  /**
   * Re-tunes the glyph. Set `--icon-primary` (for a dark surface, for
   * example `--icon-primary: currentColor`) or `--icon-secondary` to
   * change a tone slot.
   */
  style?: CSSProperties;
  /**
   * An accessible name for a glyph that stands alone. Omitted — the
   * default — the glyph is decorative and hidden from assistive
   * technology, so a labelled control never reads it twice.
   */
  title?: string;
};

export function KhelIcon({
  name,
  size = 20,
  className,
  style,
  title,
}: KhelIconProps) {
  const labelled = Boolean(title);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={PRIMARY}
      className={className}
      style={style}
      role={labelled ? "img" : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
      data-icon={name}
    >
      {labelled ? <title>{title}</title> : null}
      {GLYPHS[name]}
    </svg>
  );
}
