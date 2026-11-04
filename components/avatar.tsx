// Person avatar — the displayed name's INITIALS.
//
// Human steering (2 November 2026): "also for user profile … please use
// the name initials only, like others". The generated/gradient art is
// superseded. Every person avatar now draws the same flat initials the
// member chips, the member profile and the staff detail already use:
//
//   - the first two non-empty words of the displayed name ("Asha Rao" →
//     AR, "Asha Venkata Rao" → AV);
//   - the first GRAPHEME of a single name ("Madonna" → M, "Émile" → É),
//     so a surrogate pair is never split in half;
//   - "?" when there is no name at all — an honest unknown, never a
//     fabricated identity.
//
// The initials come from the NAME the row already shows; the stable
// person/member id stays only as identity metadata for the existing
// checks and never drives what is drawn. There is no storage, no upload,
// no extra data lookup, no dependency and no generated art.
//
// Appearance: a flat themed surface (`--accent-soft` / `--accent-ink`, in
// both presets), the caller's size and class, a circle by default and a
// square when `square` is set. It is decorative beside a visible name and
// a named image (`role="img"` + the label) when it stands alone.

// A GRAPHEME is not a code point. "é" can be written as e + U+0301 (two
// code points, one grapheme), and an Indian-script consonant keeps its
// vowel sign or conjunct (मी, क्ष). The initials take the first GRAPHEME
// of each word, so a combining mark is never cut off its base letter.
//
// Intl.Segmenter with the grapheme granularity is the accurate, built-in
// answer (Node 22 and every current browser); the code-point fallback is
// only for a runtime without it, and is still safer than a UTF-16 unit.
const GRAPHEME_SEGMENTER =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter("en", { granularity: "grapheme" })
    : null;

function firstGrapheme(word: string): string {
  if (GRAPHEME_SEGMENTER) {
    for (const { segment } of GRAPHEME_SEGMENTER.segment(word)) return segment;
  }
  return Array.from(word)[0] ?? "";
}

/**
 * The initials for a displayed name.
 *
 * Exported so a surface that already owns a name can use the same
 * convention without redrawing the avatar.
 */
export function personInitials(name: string): string {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  return words
    .slice(0, 2)
    .map(firstGrapheme)
    .join("")
    .toUpperCase();
}

export type PersonAvatarProps = {
  /** The displayed name the initials come from. */
  name: string;
  /**
   * The stable person/member id. Identity metadata only: it is kept for
   * the existing identity checks and never drawn.
   */
  seed?: string;
  size?: number;
  square?: boolean;
  /** Accessible name. When absent the avatar is decorative. */
  label?: string;
  className?: string;
};

export function PersonAvatar({
  name,
  seed,
  size = 40,
  square = false,
  label,
  className,
}: PersonAvatarProps) {
  return (
    <span
      data-testid="person-avatar"
      data-avatar-seed={seed}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={[
        "inline-grid place-items-center overflow-hidden bg-[var(--accent-soft)] font-medium text-[var(--accent-ink)]",
        square ? "rounded-none" : "rounded-full",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(11, Math.round(size / 2.6)),
      }}
    >
      {personInitials(name)}
    </span>
  );
}
