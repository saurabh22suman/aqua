"use client";

import { useEffect, useState } from "react";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";
import { MapPin } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  FACILITY_COOKIE,
  isFacilityScopedPath,
  parseFacilityValue,
} from "@/lib/facility";

// W1-6 (docs/role-surfaces-plan.md) — owner facility switcher.
// Rendered by the owner layout on the screens that actually scope data
// by facility (Home, Members, Fees, Programs/Sessions, Schedule,
// Batches, Reports). The choice is written to `?facility=<locationId>`
// and to a cookie, so it follows the owner from screen to screen;
// "All facilities" clears both. Pages resolve the URL first and the
// cookie second (lib/facility.ts), so a shared link wins over a stale
// device preference.

function readFacilityCookie(): string | undefined {
  const match = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${FACILITY_COOKIE}=`));
  return parseFacilityValue(
    match ? decodeURIComponent(match.slice(FACILITY_COOKIE.length + 1)) : undefined,
  );
}

function writeFacilityCookie(value: string | null): void {
  const base = `${FACILITY_COOKIE}=`;
  if (value === null) {
    document.cookie = `${base}; path=/; max-age=0; samesite=lax`;
    return;
  }
  document.cookie = `${base}${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
}

export function FacilitySwitcher({
  locations,
}: {
  locations: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const visible = locations.length > 1 && isFacilityScopedPath(pathname);
  const [current, setCurrent] = useState(() => searchParams.get("facility") ?? "all");

  // A page opened from the sidebar carries no `?facility=`, so adopt the
  // remembered choice and put it in the URL — the server already scoped
  // the data by that same cookie, and the select now matches the page.
  useEffect(() => {
    if (!visible || searchParams.get("facility")) return;
    const remembered = readFacilityCookie();
    if (!remembered) return;
    setCurrent(remembered);
    const next = new URLSearchParams(searchParams.toString());
    next.set("facility", remembered);
    router.replace(`${pathname}?${next.toString()}`);
  }, [pathname, router, searchParams, visible]);

  if (!visible) return null;

  function onChange(value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value === "all") {
      writeFacilityCookie(null);
      next.delete("facility");
    } else {
      writeFacilityCookie(value);
      next.set("facility", value);
    }
    setCurrent(value);
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <div className="px-5 pt-3 print:hidden">
      <label htmlFor="facility-switcher" className="sr-only">
        Facility
      </label>
      {/* A PICKER, so it wears the standard control metrics: 48px tall,
          the 10px control radius, 16px control text and the very lightly
          tinted picker surface. The SELECT is the control — it carries
          the border, the radius and the surface — so what the reader
          sees is what the control paints. The native select keeps the
          platform picker on a phone and its own keyboard behaviour. */}
      <div className="relative">
        <MapPin
          size={14}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3"
          aria-hidden="true"
        />
        <select
          id="facility-switcher"
          data-testid="facility-switcher"
          value={current}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Facility"
          className="min-h-12 w-full appearance-none rounded-ctl border border-[var(--control-border)] bg-[var(--control-surface-picker)] py-2 pl-10 pr-9 text-[16px] text-ink motion-fast transition-colors hover:border-[var(--control-border-hover)] focus:border-[var(--accent-strong)]"
        >
          <option value="all">All facilities</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
        {/* The dropdown affordance. `appearance-none` removes the
            browser's own arrow, so the picker has to say that it is a
            choice — the same decorative chevron the shared Select
            draws. */}
        <ChevronDown
          size={16}
          strokeWidth={1.8}
          data-testid="facility-switcher-chevron"
          aria-hidden="true"
          className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-ink-3"
        />
      </div>
    </div>
  );
}
