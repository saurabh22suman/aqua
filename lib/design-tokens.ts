// Server-readable mirror of the approved tokens in app/globals.css
// (@theme). The zero-JS parent document (app/p/[token]/route.ts)
// renders outside the React/Tailwind tree and cannot use CSS custom
// properties, so it reads these values instead of keeping a second,
// drifting palette (2026-10-05 audit FE-07). Keep values in sync with
// globals.css; tests/parent-contrast.test.ts asserts the text and
// status pairs the parent page actually uses.
export const TOKENS = {
  paper: "#FFFFFF",
  deck: "#EDF0EC",
  ink: "#0F1F1C",
  ink2: "#3C534F",
  ink3: "#5B6F6B",
  marine: "#0D3B36",
  water: "#0E7C86",
  good: "#1F7A43",
  goodSoft: "#E4F4EA",
  late: "#B2332B",
  lateSoft: "#FCE9E7",
  warn: "#8F5400",
  warnSoft: "#FDF0DC",
} as const;
