import Link from "next/link";
import { Compass } from "lucide-react";

// P0-2 (mobile UX audit, 2026-09-12) — the root not-found boundary.
// Every notFound() in the app (the /parent role gate, the malformed-id
// guard in lib/params.ts, missing members/enquiries/sessions) used to
// fall through to Next's bare 404: no branding, no copy, no way back.
// This page is the single friendly surface those paths now share.
export default function NotFound() {
  return (
    <main
      className="px-5 min-h-dvh grid place-items-center"
      data-testid="not-found-page"
    >
      <div className="max-w-sm text-center py-16">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-deck text-ink-3">
          <Compass size={22} aria-hidden="true" />
        </div>
        <h1 className="mt-4 font-display text-[19px] font-semibold">
          We couldn&apos;t find that page
        </h1>
        <p className="mt-2 text-[13.5px] text-ink-3 leading-snug">
          The link may be broken, or the page may have moved. Check the
          address and try again.
        </p>
        <Link
          href="/login"
          className="mt-6 inline-flex items-center justify-center rounded-pill min-h-[44px] px-5 py-3 text-[14px] font-semibold text-paper bg-[var(--accent)] transition-colors duration-150"
        >
          Go to sign in
        </Link>
      </div>
    </main>
  );
}
