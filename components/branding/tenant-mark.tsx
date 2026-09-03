import { ACCENTS, type AccentKey } from "@/lib/branding/accents";

// Phase 2.9 — fallback initials mark for tenants that haven't
// uploaded a mark yet. Inline SVG, no external request, no
// raster image. The accent comes from the resolved branding
// (architecture § 7.5: "Generated as inline SVG at request
// time, not stored"). The tenant therefore has a usable mark
// from the moment it is created — the parent page and any
// future invoice PDF need a mark before the owner gets around
// to uploading anything, and a blank placeholder reads as a
// product that doesn't know what it's doing.
//
// Sizing is up to the caller. Pass any width/height in pixels;
// the SVG scales. The mark itself is circular, so square
// sizing renders correctly at any size.

export function TenantMark({
  initials,
  accent,
  size = 44,
}: {
  initials: string;
  accent: AccentKey;
  size?: number;
}) {
  const safeInitials = initials.slice(0, 2).toUpperCase() || "?";
  const { soft, ink } = ACCENTS[accent];
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label={initials ? `${initials} mark` : "Tenant mark"}
    >
      <rect x="0" y="0" width="100" height="100" rx="22" ry="22" fill={soft} />
      <text
        x="50"
        y="50"
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="Bricolage Grotesque, system-ui, sans-serif"
        fontWeight={600}
        fontSize={safeInitials.length === 1 ? 50 : 36}
        fill={ink}
      >
        {safeInitials}
      </text>
    </svg>
  );
}
