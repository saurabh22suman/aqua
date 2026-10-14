"use client";

import { useEffect, useState } from "react";
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
      <div className="flex items-center gap-2 rounded-ctl border border-line bg-paper px-3 min-h-[44px]">
        <MapPin size={14} className="text-ink-3 flex-none" aria-hidden="true" />
        <select
          id="facility-switcher"
          data-testid="facility-switcher"
          value={current}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 bg-transparent text-[16px] min-h-[44px]"
        >
          <option value="all">All facilities</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
