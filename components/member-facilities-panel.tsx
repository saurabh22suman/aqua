"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2 } from "lucide-react";
import {
  addMemberFacilityAction,
  endMemberFacilityAction,
} from "@/lib/actions/facility-optins";
import type { OptedFacilityRow } from "@/lib/services/facility-optins";
import type { LocationOption } from "@/lib/services/people";
import { formatDateIST } from "@/lib/time/tz";
import { Select } from "@/components/ui/Select";
import { Button } from "@/components/ui/Button";

// Wave 2 (docs/role-surfaces-plan.md) — owner-side facility opt-ins on
// the member detail page. The home facility (members.location_id) is
// read-only here; additional facilities are added/ended. Billing for
// opted facilities lands with C-29 → C-33; this panel is the record.
export function MemberFacilitiesPanel({
  memberId,
  home,
  opted,
  locations,
  canWrite,
}: {
  memberId: string;
  home: { id: string; name: string };
  opted: OptedFacilityRow[];
  locations: LocationOption[];
  // R10 (2026-10-13 role-workflow audit) — opt-in/end ride
  // members.write; readers keep the list.
  canWrite: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const optedIds = new Set(opted.map((o) => o.locationId));
  const available = locations.filter(
    (l) => l.id !== home.id && !optedIds.has(l.id),
  );
  const [pick, setPick] = useState(available[0]?.id ?? "");

  async function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (!res.ok) {
        setError(res.error ?? "Something went wrong.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-4">
      <h2 className="flex items-center gap-1.5 font-display text-[14px] font-semibold">
        <Building2 size={15} className="text-ink-3" />
        Facilities
      </h2>
      <ul className="mt-2 divide-y divide-line rounded-card border border-line bg-paper">
        <li className="flex items-center justify-between gap-3 px-3.5 py-3">
          <span className="min-w-0 truncate text-[13px] font-medium">
            {home.name}
          </span>
          <span className="flex-none rounded-pill bg-deck px-2 py-0.5 text-[11px] text-ink-3">
            Home
          </span>
        </li>
        {opted.map((o) => (
          <li
            key={o.optinId}
            className="flex items-center justify-between gap-3 px-3.5 py-3"
          >
            <div className="min-w-0">
              <p className="truncate text-[13px] font-medium">{o.locationName}</p>
              <p className="text-[11px] text-ink-3">
                since {formatDateIST(o.optedOn)}
              </p>
            </div>
            {canWrite ? (
              <button
                type="button"
                onClick={() => run(() => endMemberFacilityAction({ optinId: o.optinId }))}
                disabled={busy}
                className="flex-none rounded-ctl border border-line px-3 min-h-[44px] text-[12.5px] text-ink-3 disabled:opacity-50"
              >
                End
              </button>
            ) : null}
          </li>
        ))}
      </ul>

      {canWrite && available.length > 0 ? (
        <div className="mt-2 flex gap-2">
          {/* P2 (independent review) — the shared `Select` renders its
              own `relative block` wrapper, so the flex sizing belongs on
              a LANE-OWNED wrapper around the primitive, not on the
              primitive's inner select. */}
          <div className="min-w-0 flex-1">
            <Select
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              aria-label="Facility"
              data-testid="facility-add-picker"
            >
              {available.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </div>
          <Button
            type="button"
            variant="primary"
            size="md"
            data-testid="facility-add"
            onClick={() => run(() => addMemberFacilityAction({ memberId, locationId: pick }))}
            disabled={busy || !pick}
            className="flex-none"
          >
            Add
          </Button>
        </div>
      ) : null}

      {error ? <p className="mt-1 text-[12px] text-ink-2">{error}</p> : null}
    </section>
  );
}
