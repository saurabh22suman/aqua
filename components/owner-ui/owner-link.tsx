import Link from "next/link";
import type { ComponentProps } from "react";

// Owner link — the one place the Owner product decides WHEN a page is read.
//
// Human-authorised UI change (3 November 2026): an owner's page is read
// when the owner NAVIGATES to it, not opportunistically prefetched in the
// background. The browser evidence was a normal production SPA
// profile → Edit → Cancel stalling on a prefetched RSC, while aborting
// every automatic prefetch request made all 21 journeys pass; idle direct
// RSC requests complete in 20–260 ms, so this is a per-Link UI setting,
// not a framework, caching or security patch and not a server-await/DB
// claim.
//
// The facade is a thin wrapper over the INSTALLED next/link:
//
//   - an OWNER destination asks for `prefetch={false}`: `/owner`, any
//     `/owner/...`, and `/owner?…` / `/owner#…`, including a UrlObject's
//     `pathname`. The boundary is exact — `/ownerly` is NOT an owner
//     destination;
//   - every other destination forwards the caller's `prefetch` prop (or
//     its absence, which keeps the framework default) unchanged, so the
//     shared renderers keep behaving exactly as before for coach,
//     reception and Ops;
//   - everything else is forwarded untouched: href with its query and
//     hash, events, the ref, accessibility attributes, `replace`, `scroll`
//     and every other standard Link prop.
//
// Type compatibility: the props are `ComponentProps<typeof Link>` — the
// INSTALLED Link's full signature, anchor attributes and ref included —
// not the narrower exported `LinkProps`, which omits children, className
// and the aria attributes.
//
// There is no `forwardRef` and no runtime React import: this module stays
// a plain function with React 19's ref-as-prop, so it is safe in the
// react-server condition as well as in client components. No hooks, no
// context, no private Next API and no new package. The owner's loading
// states are kept: a navigation still shows them.

const OWNER_ROOT = "/owner";

/**
 * Whether a Link destination belongs to the owner product.
 *
 * Exact boundary: `/owner`, `/owner/...`, `/owner?…`, `/owner#…`; a
 * sibling such as `/ownerly` is not an owner destination.
 */
export function isOwnerDestination(
  href: ComponentProps<typeof Link>["href"],
): boolean {
  const pathname = typeof href === "string" ? href : (href?.pathname ?? "");
  if (typeof pathname !== "string" || !pathname.startsWith(OWNER_ROOT)) {
    return false;
  }
  if (pathname.length === OWNER_ROOT.length) return true;
  const boundary = pathname.charAt(OWNER_ROOT.length);
  return boundary === "/" || boundary === "?" || boundary === "#";
}

export type OwnerLinkProps = ComponentProps<typeof Link>;

export function OwnerLink({ prefetch, ref, ...props }: OwnerLinkProps) {
  return (
    <Link
      ref={ref}
      {...props}
      prefetch={isOwnerDestination(props.href) ? false : prefetch}
    />
  );
}
