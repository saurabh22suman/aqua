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

// The in-app return from a member profile.
//
// The directory keeps its filters and scroll on the current history
// entry, and the BROWSER's Back restores them. The profile's own
// "Members" link used to open a FRESH directory, so tapping it lost
// the search, the status filter and the scroll position.
//
// The return intent is the explicit, single-use answer:
//
//   1. the directory RECORDS what it was showing when the owner opens a
//      profile;
//   2. the profile's back control ARMS that record — the owner is
//      deliberately coming back;
//   3. the directory CONSUMES it, once, and only when the tenant, the
//      actor and the facility all match.
//
// It is memory only: no URL parameter, no local or session storage, no
// person data, and no service, permission or auth change. A fresh
// visit, a deep link, another account's directory and another
// facility's directory never adopt it.

type MembersReturnIntent = MembersListNavigationState & { armed: boolean };

let returnIntent: MembersReturnIntent | null = null;

/** Record what the directory was showing when the owner opens a profile. */
export function recordMembersReturnIntent(state: MembersListNavigationState): void {
  returnIntent = { ...state, armed: false };
}

/**
 * Whether a return record exists for this tenant/actor and facility — armed or
 * not. PURE: it neither takes, arms nor clears anything, and it returns no
 * person data, so a caller can ask "is there scoped state to preserve?" without
 * disturbing the directory's own return.
 */
export function hasMembersReturnIntent(
  namespace: string,
  facility: string,
): boolean {
  const intent = returnIntent;
  if (!intent) return false;
  if (intent.namespace !== namespace) return false;
  const normalise = (value: string) => (value === "" || value === "all" ? "all" : value);
  return normalise(intent.locationId) === normalise(facility);
}

/** The profile's back control arms the record: the owner is coming back. */
export function armMembersReturnIntent(): void {
  if (returnIntent) returnIntent.armed = true;
}

/**
 * The armed intent for this tenant, actor and facility — WITHOUT taking
 * it. Taking it here would lose it when the effect that reads it is
 * cancelled (a StrictMode double setup), and the directory would come
 * back fresh. It is cleared once the restore has been attempted.
 */
export function peekMembersReturnIntent(
  namespace: string,
  locationId: string,
): MembersListNavigationState | null {
  const intent = returnIntent;
  if (!intent || !intent.armed) return null;
  // Another account's directory never takes it.
  if (intent.namespace !== namespace) return null;
  // The same account, another facility: the record is stale.
  if (intent.locationId !== locationId) {
    returnIntent = null;
    return null;
  }
  return {
    namespace,
    locationId,
    search: intent.search,
    status: intent.status,
    scrollY: intent.scrollY,
  };
}

/** The intent is spent: the next arrival is a fresh directory. */
export function clearMembersReturnIntent(): void {
  returnIntent = null;
}

/**
 * Where the profile's in-app Members link goes.
 *
 * The plain directory when there is no return to make, and the scope the
 * directory was read under otherwise: the facility cookie may be absent,
 * and the scope belongs in the link so the directory comes back to the
 * same place. No person data and no filter ever travels in the URL.
 */
export function membersReturnHref(): string {
  const intent = returnIntent;
  if (!intent || !intent.locationId) return "/owner/members";
  return `/owner/members?facility=${intent.locationId}`;
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
    // Restore one recorded state: the filters are applied, the rows are
    // re-read, and the scroll happens ONLY after the authoritative
    // refresh succeeded.
    const restore = async (stored: MembersListNavigationState | null) => {
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
    const applyHistoryState = async (fromPopstate = false) => {
      if (fromPopstate) consumeMembersListNavigationIntent();
      await restore(readMembersListNavigation(namespace, locationId));
    };
    // An armed return intent is peeked on EVERY mount, so it can never
    // linger; it is applied only when the owner came back through the
    // profile's own link and not through the browser's Back, and it is
    // cleared once the restore has been attempted.
    //
    // PRECEDENCE: a valid matching armed return WINS over a stale popstate.
    // Edit → Cancel returns with `router.back()`, which leaves the module
    // popstate flag set; if that flag were read first, the directory would
    // read the profile/Notes history entry (no saved list) and come back
    // unfiltered, discarding the scope the Members link deliberately recorded.
    // The flag is consumed either way, so it can never replay on a later mount.
    const intent = peekMembersReturnIntent(namespace, locationId);
    const returnedByPopstate = consumeMembersListNavigationIntent();
    if (intent) {
      void restore(intent)
        .catch(() => undefined)
        .finally(() => clearMembersReturnIntent());
    } else if (returnedByPopstate) {
      void applyHistoryState();
    }
    const onPopstate = () => {
      void applyHistoryState(true);
    };
    window.addEventListener("popstate", onPopstate);
    return () => {
      disposed.current = true;
      sequence.current += 1;
      // A cancelled restore may be retried by the next setup.
      lastSignature.current = null;
      cancelRestore();
      window.removeEventListener("popstate", onPopstate);
    };
  }, [namespace, locationId]);

  return { save, invalidate };
}
