// Owner Lavender B — the quiet artwork at the foot of the sidebar.
//
// A small horizon line with two rolling hills and a low sun: the same
// visual language as the sport artwork beside the owner heading, drawn
// from the same semantic illustration tokens so it belongs to the
// preset the reader is in.
//
// It is DECORATION and it says nothing: no slogan, no claim, no
// figure. It exists to stop the bottom of the sidebar from being a
// blank block, and it is hidden from assistive technology.

export function ClubFooterArt({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 200 85"
      className={`h-[68px] w-full ${className}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M10 60Q35 40 60 60T110 60T160 60T210 60"
        stroke="var(--illustration-secondary)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M-10 73Q15 53 40 73T90 73T140 73T190 73"
        stroke="var(--illustration-secondary)"
        strokeWidth="2"
        strokeLinecap="round"
        opacity="0.7"
      />
      <circle cx="146" cy="23" r="10" fill="var(--illustration-accent)" opacity="0.85" />
      <path
        d="M44 50l25-22 22 22M69 28v30M104 49l17-13 20 14"
        stroke="var(--illustration-primary)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
