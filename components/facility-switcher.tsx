"use client";

import { MapPin } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// W1-6 (docs/role-surfaces-plan.md) — owner facility switcher.
// Rendered by the owner layout on every owner screen, only when the
// tenant actually has more than one facility. The choice persists in
// `?facility=<locationId>`; "All facilities" removes the param, which
// is the consolidated view. Screens read the param server-side (the
// members list today; Wave 2 extends it once batches carry a location).
export function FacilitySwitcher({
  locations,
}: {
  locations: { id: string; name: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  if (locations.length <= 1) return null;

  const current = searchParams.get("facility") ?? "all";

  function onChange(value: string) {
    const next = new URLSearchParams(searchParams.toString());
    if (value === "all") next.delete("facility");
    else next.set("facility", value);
    const query = next.toString();
    router.push(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <div className="px-5 pt-3">
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
