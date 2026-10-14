"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { formatDateIST } from "@/lib/time/tz";

// Roster publication panel — its own scope state, deliberately
// independent of the add-shift form (owner-UI review P1, 2026-10-13).
// The owner sees the week and scope before publishing, and editing a
// shift draft cannot change the target.

export function RosterPublishPanel({
  weekStart,
  locations,
  weekLocationId,
  pending,
  onPublish,
}: {
  weekStart: string;
  locations: Array<{ id: string; name: string }>;
  weekLocationId: string | null;
  pending: boolean;
  onPublish: (locationId: string | null) => void;
}) {
  const [publishLocationId, setPublishLocationId] = useState(
    weekLocationId ?? "",
  );

  useEffect(() => {
    setPublishLocationId(weekLocationId ?? "");
  }, [weekLocationId]);

  const publishScopeName =
    locations.find((location) => location.id === publishLocationId)?.name ??
    "all locations";

  return (
    <div className="rounded-card border border-line bg-paper p-3.5">
      <p className="text-[12px] font-medium text-ink-2">
        Publish the week of {formatDateIST(weekStart)}
      </p>
      <p className="mt-0.5 text-[12px] text-ink-3">
        Scope: {publishScopeName}. Draft shifts at this scope become visible
        to staff after publishing.
      </p>
      {locations.length > 1 ? (
        <label className="mt-2 block">
          <span className="mb-1 block text-[11px] text-ink-3">
            Publication scope
          </span>
          <select
            value={publishLocationId}
            onChange={(e) => setPublishLocationId(e.target.value)}
            className="min-h-11 w-full rounded-ctl border border-line bg-paper px-3 text-[16px] text-ink"
            data-testid="roster-publish-scope"
          >
            <option value="">All locations</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="mt-2">
        <Button
          variant="primary"
          size="md"
          disabled={pending}
          onClick={() => onPublish(publishLocationId || null)}
          data-testid="roster-publish"
        >
          Publish this week
          {publishLocationId ? ` · ${publishScopeName}` : ""}
        </Button>
      </div>
    </div>
  );
}
