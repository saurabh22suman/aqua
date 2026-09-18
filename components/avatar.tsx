"use client";

import Avatar from "boring-avatars";

// U-09 — one avatar everywhere, no photos anywhere.
//
// `boring-avatars` (MIT, local SVG generation) is the one approved
// dependency for this: deterministic art from a stable seed, no
// storage, no upload, no PII. The seed MUST be an id (person_id /
// member id), never a display name — a rename must not change a
// person's avatar. TenantMark keeps branded initials; this is for
// people.
//
// Client component: boring-avatars drives each generated SVG from
// React.useId(), which is a hook — rendering it directly from a
// Server Component throws. Client components are still SSR'd, and
// useId is stable across hydration, so the server and client markup
// match. The parent surface (`/p/[token]`) never imports this file,
// so it stays zero-JS.
//
// Approved palettes are calm, semantic-token-adjacent tones, not the
// library default. Callers may pass the tenant accent palette later;
// until then every surface shares one consistent set.

// Generated avatar art, not UI chrome: boring-avatars needs literal
// colours (it builds SVG fills from them), and the DESIGN.md token
// system has no mechanism to feed CSS variables into the library.
// The values are the approved calm set from the U-09 task, not the
// library default.
const DEFAULT_COLORS = ["#0f766e", "#14b8a6", "#f59e0b", "#64748b", "#a7f3d0"];

export type AvatarVariant =
  | "marble"
  | "beam"
  | "pixel"
  | "sunset"
  | "ring"
  | "bauhaus";

export type PersonAvatarProps = {
  seed: string;
  size?: number;
  square?: boolean;
  variant?: AvatarVariant;
  colors?: string[];
  /** Accessible name. When absent the avatar is decorative. */
  label?: string;
  className?: string;
};

export function PersonAvatar({
  seed,
  size = 40,
  square = false,
  variant = "marble",
  colors = DEFAULT_COLORS,
  label,
  className,
}: PersonAvatarProps) {
  return (
    <span
      className={className}
      data-testid="person-avatar"
      data-avatar-seed={seed}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <Avatar
        name={seed}
        size={size}
        square={square}
        variant={variant}
        colors={[...colors]}
      />
    </span>
  );
}
