"use client";

import { useEffect, useRef } from "react";

// Small navigation-state helper for the owner members list. Filters and scroll
// live only on the current history entry; no person payload and no browser or
// session storage. The namespace is supplied by the server page from the
// current tenant + actor, and the stored location must match the live facility.

export type MembersListNavigationState = {
  namespace: string;
  locationId: string;
  search: string;
  status: string;
  scrollY: number;
};

const STATE_KEY = "ownerMembersList";
const MAX_SEARCH_LENGTH = 200;
const VALID_STATUSES = new Set(["trial", "active", "paused", "lapsed", "left"]);

// Browser Back/Forward fires popstate before a remounted list can register its
// own listener. Record that intent at module scope so a fresh mount applies the
// saved entry once; ordinary test/fresh mounts must not adopt stale state.
let navigationIntent = false;
if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => {
    navigationIntent = true;
  });
}

export function consumeMembersListNavigationIntent(): boolean {
  const value = navigationIntent;
  navigationIntent = false;
  return value;
}

export function parseMembersListNavigation(
  raw: unknown,
  namespace: string,
  locationId: string,
): MembersListNavigationState | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (
    value.namespace !== namespace ||
    value.locationId !== locationId ||
    typeof value.search !== "string" ||
    value.search.length > MAX_SEARCH_LENGTH ||
    typeof value.status !== "string" ||
    (value.status !== "" && !VALID_STATUSES.has(value.status)) ||
    typeof value.scrollY !== "number" ||
    !Number.isFinite(value.scrollY) ||
    value.scrollY < 0
  ) {
    return null;
  }
  return {
    namespace,
    locationId,
    search: value.search,
    status: value.status,
    scrollY: value.scrollY,
  };
}

export function readMembersListNavigation(
  namespace: string,
  locationId: string,
): MembersListNavigationState | null {
  return parseMembersListNavigation(
    (window.history.state as Record<string, unknown> | null)?.[STATE_KEY],
    namespace,
    locationId,
  );
}

export function writeMembersListNavigation(
  state: MembersListNavigationState,
): void {
  window.history.replaceState(
    {
      ...(window.history.state ?? {}),
      [STATE_KEY]: state,
    },
    "",
    window.location.href,
  );
}


/**
 * Keep the current members list entry's filter/scroll state and apply it only
 * for a real Back/Forward. `apply` must return true only after authoritative
 * filtered rows were committed; stale/failed requests must return false.
 */
export function useMembersListNavigation({
  namespace,
  locationId,
  apply,
}: {
  namespace: string;
  locationId: string;
  apply: (state: MembersListNavigationState) => Promise<boolean>;
}) {
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const sequence = useRef(0);
  const disposed = useRef(false);
  const outerFrame = useRef<number | null>(null);
  const innerFrame = useRef<number | null>(null);
  const lastSignature = useRef<string | null>(null);

  function cancelRestore() {
    if (outerFrame.current !== null) cancelAnimationFrame(outerFrame.current);
    if (innerFrame.current !== null) cancelAnimationFrame(innerFrame.current);
    outerFrame.current = null;
    innerFrame.current = null;
  }

  function invalidate() {
    sequence.current += 1;
    cancelRestore();
  }

  function save(search: string, status: string, scrollY: number) {
    invalidate();
    lastSignature.current = null;
    writeMembersListNavigation({ namespace, locationId, search, status, scrollY });
  }

  useEffect(() => {
    disposed.current = false;
    const applyHistoryState = async (fromPopstate = false) => {
      if (fromPopstate) consumeMembersListNavigationIntent();
      const stored = readMembersListNavigation(namespace, locationId);
      if (!stored) return;
      const signature = [
        namespace,
        locationId,
        stored.search,
        stored.status,
        stored.scrollY,
      ].join("\u0000");
      if (lastSignature.current === signature) return;
      lastSignature.current = signature;
      const epoch = ++sequence.current;
      cancelRestore();
      const applied = await applyRef.current(stored);
      if (!applied || disposed.current || epoch !== sequence.current) return;
      outerFrame.current = requestAnimationFrame(() => {
        if (disposed.current || epoch !== sequence.current) return;
        innerFrame.current = requestAnimationFrame(() => {
          if (disposed.current || epoch !== sequence.current) return;
          window.scrollTo(0, stored.scrollY);
        });
      });
    };
    if (consumeMembersListNavigationIntent()) void applyHistoryState();
    const onPopstate = () => {
      void applyHistoryState(true);
    };
    window.addEventListener("popstate", onPopstate);
    return () => {
      disposed.current = true;
      sequence.current += 1;
      cancelRestore();
      window.removeEventListener("popstate", onPopstate);
    };
  }, [namespace, locationId]);

  return { save, invalidate };
}
