// The lane motif — the quiet sports cue on the desktop panel.
//
// A wave (the Aqua mark's own shape) over three lane lines, in the
// preset's accent at decreasing opacity. Small and low-contrast on
// purpose: a club's identity comes from the club's mark, so this reads
// as texture that suggests lanes and water without becoming an
// illustration. Decorative, and hidden from assistive technology.

export function LaneMotif({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 240 108"
      fill="none"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <g stroke="var(--accent)" strokeWidth="3" strokeLinecap="round">
        <path
          d="M0 14c24 0 30-8 54-8s30 8 54 8 30-8 54-8 30 8 54 8"
          opacity="0.26"
        />
        <line x1="0" y1="44" x2="164" y2="44" opacity="0.2" />
        <line x1="28" y1="70" x2="212" y2="70" opacity="0.14" />
        <line x1="56" y1="96" x2="240" y2="96" opacity="0.09" />
      </g>
    </svg>
  );
}
