// Aqua — the product's own mark and wordmark, drawn in theme tokens.
//
// The installed app icon (app/icon.svg) is a wave under a sun on a
// rounded square. The login entry repeats that shape in the active
// preset's accent, so the first screen a member sees carries the
// identity of the app they installed. No raster asset, no second brand
// system, no hardcoded colour.
//
// The mark is decorative: the product name beside it carries the
// meaning, so the SVG is hidden from assistive technology and the
// lockup exposes a single readable name.

export function SportsMark({
  size = 40,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 64 64"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <rect width="64" height="64" rx="18" fill="var(--accent-soft)" />
      <circle cx="45" cy="21" r="6.5" fill="var(--accent)" />
      <path
        d="M10 38c5 0 7-6 12-6s7 6 12 6 7-6 12-6 7 6 8 6"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <path
        d="M12 50c5 0 7-6 12-6s7 6 12 6 7-6 12-6 7 6 8 6"
        fill="none"
        stroke="var(--accent)"
        strokeWidth="4"
        strokeLinecap="round"
        opacity="0.45"
      />
    </svg>
  );
}

/**
 * The wordmark. One product name, one quiet descriptor — never a
 * tenant name: the tenant is unknown before sign-in, and naming one
 * here would leak which club a number belongs to.
 */
export function BrandLockup({
  size = "md",
  className = "",
}: {
  size?: "sm" | "md";
  className?: string;
}) {
  const markSize = size === "sm" ? 32 : 40;
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <SportsMark size={markSize} />
      <span className="flex flex-col justify-center">
        <span className="font-display text-[17px] font-semibold leading-none text-ink">
          Aqua
        </span>
        <span className="mt-1 text-[11px] font-medium leading-none text-ink-3">
          for sports clubs
        </span>
      </span>
    </span>
  );
}
