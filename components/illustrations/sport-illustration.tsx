import type { ReactElement } from "react";
import type { SportKey } from "./resolve-sport";

// Owner Lavender B — the small sport artwork.
//
// ORIGINAL art, drawn as SVG inside the app. It is never a raster of
// the approved board: the board was a picture of a screen, and dropping
// it into a page would bring its gradients, its fake figures and its
// crop with it.
//
// The rules the artwork obeys:
//
//   * SMALL. It sits beside a heading; it never becomes the screen.
//   * COORDINATED. Every variant is drawn on the same 64×48 grid, with
//     the same rounded stroke language, from the same six semantic
//     illustration tokens — so the swimmer, the badminton player and
//     the footballer look like one set.
//   * STATIC FIRST. The picture is still until the reader hovers or
//     focuses it, the movement is a single small transform, and a
//     reduced-motion reader sees a still picture (the guard lives in
//     app/globals.css).
//   * NO SMIL. `<animate>` and `<animateTransform>` ignore
//     prefers-reduced-motion, so the artwork uses CSS only.
//   * DETERMINISTIC. The markup is identical on every render — no
//     random ids, no generated content.

const LABEL: Record<SportKey, string> = {
  swimming: "Swimming",
  badminton: "Badminton",
  football: "Football",
  club: "Your club",
};

export type SportIllustrationProps = {
  sport: SportKey;
  /** Rendered width in pixels. The height follows the 64:48 art. */
  size?: number;
  className?: string;
};

export function SportIllustration({
  sport,
  size = 60,
  className = "",
}: SportIllustrationProps) {
  const height = Math.round((size * 48) / 64);
  return (
    <span
      className={`illustration-motion inline-flex flex-none items-center justify-center ${className}`}
      data-illustration={sport}
    >
      <svg
        role="img"
        aria-label={`${LABEL[sport]} artwork`}
        data-variant={sport}
        viewBox="0 0 64 48"
        width={size}
        height={height}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g className="illustration-drift">{ART[sport]}</g>
      </svg>
    </span>
  );
}

const ART: Record<SportKey, ReactElement> = {
  // A swimmer's head above the waterline — a cap, a face and one arm
  // going into the water — on the same horizon every variant shares.
  swimming: (
    <g strokeLinecap="round" strokeLinejoin="round">
      <path
        d="M2 34q6-4 12 0t12 0 12 0 12 0 12 0"
        stroke="var(--illustration-water)"
        strokeWidth="2.5"
      />
      <path
        d="M2 41q6-4 12 0t12 0 12 0 12 0 12 0"
        stroke="var(--illustration-water)"
        strokeWidth="2"
        opacity="0.6"
      />
      {/* The arm entering the water. */}
      <path
        d="M29 25q9 2 12 9"
        stroke="var(--illustration-ink)"
        strokeWidth="3.5"
      />
      {/* The head, and the cap over the top half of it. */}
      <circle
        cx="23"
        cy="19"
        r="8"
        fill="var(--illustration-secondary)"
        stroke="var(--illustration-ink)"
        strokeWidth="2"
      />
      <path d="M15 19a8 8 0 0 1 16 0z" fill="var(--illustration-primary)" />
    </g>
  ),

  // A racket and a shuttlecock, on the same horizon.
  badminton: (
    <g strokeLinecap="round" strokeLinejoin="round">
      <path
        d="M2 34q6-4 12 0t12 0 12 0 12 0 12 0"
        stroke="var(--illustration-water)"
        strokeWidth="2.5"
      />
      {/* The handle. */}
      <path d="M33 25 22 42" stroke="var(--illustration-ink)" strokeWidth="4" />
      {/* The strings. */}
      <path
        d="M34 8.5v19M42 8.5v19M32 13.5h14M31 18.5h16"
        stroke="var(--illustration-secondary)"
        strokeWidth="1.6"
      />
      {/* The racket head. */}
      <ellipse
        cx="38"
        cy="15"
        rx="11"
        ry="13"
        fill="var(--illustration-surface)"
        stroke="var(--illustration-primary)"
        strokeWidth="3"
      />
      {/* The shuttlecock: a cork and its feathers. */}
      <path d="M6 16 10 6l6 10z" fill="var(--illustration-accent)" />
      <circle cx="11" cy="18" r="3" fill="var(--illustration-ink)" />
    </g>
  ),

  // A football with its panel pattern, resting on the same horizon.
  football: (
    <g strokeLinecap="round" strokeLinejoin="round">
      <path
        d="M2 34q6-4 12 0t12 0 12 0 12 0 12 0"
        stroke="var(--illustration-water)"
        strokeWidth="2.5"
      />
      <circle
        cx="32"
        cy="20"
        r="14"
        fill="var(--illustration-surface)"
        stroke="var(--illustration-ink)"
        strokeWidth="2.5"
      />
      <path
        d="M32 12.5l6 4.2-2.3 7.1h-7.4L26 16.7z"
        fill="var(--illustration-primary)"
        stroke="var(--illustration-ink)"
        strokeWidth="1.8"
      />
      <path
        d="M21.5 16.5 26.5 13M42.5 16.5 37.5 13M20 24.5l5-1.5M44 24.5l-5-1.5"
        stroke="var(--illustration-ink)"
        strokeWidth="1.8"
      />
    </g>
  ),

  // The neutral club mark: a pennant on the same horizon. It is what a
  // club gets when its own programme names say nothing about a sport —
  // a mark, never a guess.
  club: (
    <g strokeLinecap="round" strokeLinejoin="round">
      <path
        d="M2 34q6-4 12 0t12 0 12 0 12 0 12 0"
        stroke="var(--illustration-water)"
        strokeWidth="2.5"
      />
      <path d="M19 42V6" stroke="var(--illustration-ink)" strokeWidth="4" />
      <path
        d="M19 8h26l-7 8 7 8H19z"
        fill="var(--illustration-primary)"
        stroke="var(--illustration-ink)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="29" cy="16" r="3.6" fill="var(--illustration-accent)" />
    </g>
  ),
};
