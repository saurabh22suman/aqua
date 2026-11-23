import { Suspense } from "react";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { OwnerStageScope } from "@/components/owner-home/owner-facility-scope";
import { formatFullDateIST } from "@/lib/time/tz";

// Owner Today — the head of the photographic stage.
//
// Floodlit puts the date and the authorized facility scope at the top of
// the stage, with the page title under them; the figures follow inside
// the same block. The scope is the REAL switcher (see
// owner-facility-scope.tsx); its option list is resolved and
// location-filtered by the owner layout, so this header adds no read and
// no grant.
export function OwnerHomeHeader({ today }: { today: string }) {
  return (
    <>
      <header className="floodlit-hero-top">
        <p className="floodlit-date">
          <OwnerIcon name="calendar" size={15} />
          <time dateTime={today}>{formatFullDateIST(today)}</time>
        </p>
        <Suspense
          fallback={
            <span role="status" className="sr-only">
              Loading clubs…
            </span>
          }
        >
          <OwnerStageScope />
        </Suspense>
      </header>
      <h1 id="owner-home-title" className="floodlit-title">
        Club overview
      </h1>
    </>
  );
}
