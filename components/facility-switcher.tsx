"use client";

import { useEffect, useState } from "react";
import { MapPin } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/Select";
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
  // The URL is the scope the page is rendered with, so the CONTROL must
  // always show the URL's facility — including after a Back navigation,
  // which re-renders this component with a new search param WITHOUT
  // remounting it. A state that is only written by onChange would keep
  // showing the facility the operator just navigated away from, while the
  // page below is scoped by the URL: the control would be lying.
  const urlFacility = searchParams.get("facility") ?? "all";
  const [current, setCurrent] = useState(urlFacility);
  useEffect(() => {
    setCurrent(urlFacility);
  }, [urlFacility]);

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
      {/* The shared PICKER: 48px tall, the 10px control radius, 16px
          control text and the very lightly tinted picker surface. It
          opens the shared listbox — our own dropdown — instead of the
          operating system's, and it draws the chevron that says the
          row is a choice. The location pin sits in front of it. */}
      <div className="relative">
        <MapPin
          size={14}
          className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-3"
          aria-hidden="true"
        />
        <Select
          id="facility-switcher"
          data-testid="facility-switcher"
          value={current}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Facility"
          className="pl-10"
        >
          <option value="all">All facilities</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
