// Phase 2.9 — accent palette + keys, in code only (no Tailwind
// class names, never a free-text hex). Imported by both the
// service layer (for writing/reading tenants.branding.jsonb) and
// the client form (for rendering swatches and the inline-SVG
// fallback mark). Splitting this out of lib/services/branding.ts
// keeps pg out of the client bundle — see docs/agent-onboarding.md's
// "shared/cross-cutting" note.

export const ACCENTS = {
  mango: { base: "#FF7A18", soft: "#FFEEE1", ink: "#B84E00" },
  marine: { base: "#0D3B36", soft: "#E3F1F2", ink: "#062722" },
  indigo: { base: "#3F4DAA", soft: "#E5E7F5", ink: "#272F70" },
  plum: { base: "#7E2B6E", soft: "#F4E5EE", ink: "#4D1543" },
  forest: { base: "#1F5E3A", soft: "#DFEEE3", ink: "#0F3220" },
  slate: { base: "#41525A", soft: "#E6ECEE", ink: "#222C32" },
} as const;

export const ACCENT_KEYS = [
  "mango",
  "marine",
  "indigo",
  "plum",
  "forest",
  "slate",
] as const satisfies ReadonlyArray<keyof typeof ACCENTS>;

export const DEFAULT_ACCENT: (typeof ACCENT_KEYS)[number] = "mango";

export type AccentKey = (typeof ACCENT_KEYS)[number];

export function isAccentKey(value: unknown): value is AccentKey {
  return typeof value === "string" && (ACCENT_KEYS as readonly string[]).includes(value);
}

// Pure helper — derives one or two uppercase initials from a
// short name. Imported separately because the form and the mark
// component both need it without pulling in the service layer.
export function deriveInitials(shortName: string | null | undefined): string {
  if (!shortName) return "";
  const words = shortName.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}
