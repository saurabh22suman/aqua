"use client";

import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

// Owner light · People lane (3 November 2026) — the member edit ENTRY intent.
//
// The normal-Chrome failure this addresses: profile → Edit → clean Cancel
// sometimes leaves the owner on the edit URL for 10 s (r7: the first fast
// cycle succeeds in 131 ms, the next stalls). Every rejected candidate
// (seeds, prefetch=false, pending state, template, boundary relocation) tried
// to make that forward navigation commit. This one stops asking for it: when
// the edit was demonstrably opened from the profile's own Edit details link in
// the same tenant/actor, member and facility, Cancel returns with the browser's
// own Back instead of a fresh navigation to the same URL.
//
// The intent is one-time module memory:
//   - the profile's Edit link records it on Next's public `onNavigate`, which
//     the installed 15.5.28 `link.js` calls only for a plain, unmodified, local
//     click (modified clicks return before `onNavigate`);
//   - the edit form peeks it (pure), validates tenant/actor, member, facility
//     and the exact edit destination, and CONSUMES it after mount;
//   - a stale, consumed, deep-linked or mismatched edit finds nothing and keeps
//     the existing real profile href navigation;
//   - the one-time module memory below is separate from the bounded
//     history-entry record (`member-edit-history.ts`), which is ordinary
//     navigation state on this edit entry and can outlive a reload;
//   - no storage, no private Next API, no timer.
//
// StrictMode: peeking is pure and the captured origin lives in a ref, so the
// effect's second setup does not erase the origin captured by the first.

export type MemberEditEntry = {
  /** `${tenantId}:${userId}` — the server-resolved actor namespace. */
  namespace: string;
  memberId: string;
  /** The canonical facility scope the profile and the edit share. */
  facility: string;
  /** The exact href the Edit details link navigates to. */
  editHref: string;
  /** The exact profile URL the owner came from. */
  originHref: string;
  /** Opaque one-time token, so a consumed intent cannot be reused. */
  token: string;
};

export type MemberEditCapture = {
  identity: MemberEditExpectation;
  originHref: string;
  token: string;
};

import {
  RECORD_VERSION,
  sameMemberEditIdentity,
  writeMemberEditHistoryRecord,
} from "@/components/member-detail/member-edit-history";
import type { MemberEditExpectation } from "@/components/member-detail/member-edit-history";

// Re-exported so every existing consumer and test keeps importing this module.
export {
  EDIT_ENTRY_STATE_KEY,
  parseMemberEditHistoryRecord,
  readMemberEditHistoryRecord,
  resolveHistoryEditReturn,
  writeMemberEditHistoryRecord,
} from "@/components/member-detail/member-edit-history";
export type {
  MemberEditExpectation,
  MemberEditHistoryRecord,
} from "@/components/member-detail/member-edit-history";

let currentEntry: MemberEditEntry | null = null;

export function recordMemberEditEntry(
  entry: Omit<MemberEditEntry, "token"> & { token?: string },
): MemberEditEntry {
  currentEntry = {
    ...entry,
    token: entry.token ?? crypto.randomUUID(),
  };
  return currentEntry;
}

/** Pure peek: never consumes, so a StrictMode render cannot erase the intent. */
export function peekMemberEditEntry(): MemberEditEntry | null {
  return currentEntry;
}

/** Consume exactly the intent that was captured, once. */
export function consumeMemberEditEntry(token: string): void {
  if (currentEntry?.token === token) currentEntry = null;
}

/**
 * Clear the pending intent. With a token, only THAT intent is cleared, so a
 * source link can never erase a newer intent.
 */
export function clearMemberEditEntry(token?: string): void {
  if (token === undefined || currentEntry?.token === token) currentEntry = null;
}

/** The intent for THIS edit, or null when it does not match exactly. */
export function matchMemberEditEntry(
  expected: MemberEditExpectation,
): MemberEditEntry | null {
  const entry = currentEntry;
  if (!entry) return null;
  if (entry.namespace !== expected.namespace) return null;
  if (entry.memberId !== expected.memberId) return null;
  if (entry.facility !== expected.facility) return null;
  if (entry.editHref !== expected.editHref) return null;
  return entry;
}

/** The full capture for this edit, or null. Pure: never consumes. */
export function captureMemberEditOrigin(
  expected: MemberEditExpectation,
): MemberEditCapture | null {
  const match = matchMemberEditEntry(expected);
  if (!match) return null;
  return {
    identity: {
      namespace: match.namespace,
      memberId: match.memberId,
      facility: match.facility,
      editHref: match.editHref,
    },
    originHref: match.originHref,
    token: match.token,
  };
}

/** Consume exactly this capture's token — never a newer intent. */
export function consumeCapturedMemberEdit(capture: MemberEditCapture): void {
  consumeMemberEditEntry(capture.token);
}

/**
 * The origin to return to RIGHT NOW, or null. Called from the click handler
 * (never during render, because the browser URL only changes when the router
 * commits): the capture must still describe the CURRENT props, and the browser
 * must actually be on the expected edit destination.
 */
export function resolveMemberEditReturn(
  capture: MemberEditCapture | null,
  expected: MemberEditExpectation | null,
): string | null {
  if (!capture || !expected) return null;
  if (!sameMemberEditIdentity(capture.identity, expected)) return null;
  const current = `${window.location.pathname}${window.location.search}`;
  if (current !== expected.editHref) return null;
  return capture.originHref;
}

/**
 * The one place a DIRECT edit return leaves the client: a normal document
 * navigation to the canonical profile href. Wrapped so the target is testable
 * and so no caller has to reach for `window.location` directly.
 */
export const memberEditDocumentNavigation = {
  assign(href: string): void {
    window.location.assign(href);
  },
};

/**
 * The capture this mount owns. The identity is snapshotted once and the effect
 * consumes only that token, so a StrictMode second setup and a later intent
 * recorded by another surface are both safe.
 */
export function useMemberEditOrigin(
  expected: MemberEditExpectation | null,
): MemberEditCapture | null {
  const [capture] = useState<MemberEditCapture | null>(() =>
    expected ? captureMemberEditOrigin(expected) : null,
  );

  useEffect(() => {
    if (!capture) return;
    consumeCapturedMemberEdit(capture);
    // Stamp the CURRENT edit history entry, after mount and only once the
    // browser is really on the expected edit destination.
    const current = `${window.location.pathname}${window.location.search}`;
    if (current !== capture.identity.editHref) return;
    writeMemberEditHistoryRecord({
      v: RECORD_VERSION,
      token: capture.token,
      ...capture.identity,
      sourceHref: capture.originHref,
    });
  }, [capture]);

  return capture;
}

/**
 * The profile's Edit details link. Same href, text and gate as before; it only
 * records the one-time entry intent when Next tells us the owner navigated.
 */
export function MemberEditEntryLink({
  href,
  namespace,
  memberId,
  facility,
  className,
  children,
}: {
  href: string;
  namespace: string;
  memberId: string;
  facility: string;
  className?: string;
  children: ReactNode;
}) {
  const tokenRef = useRef<string | null>(null);
  const sourcePath = `/owner/members/${memberId}`;

  useEffect(() => {
    return () => {
      // The source link unmounted. Keep the intent only when the browser
      // actually arrived at the edit destination or is still on this profile;
      // a DIFFERENT committed destination means the Edit navigation was
      // abandoned, and the pending intent must not survive as a valid entry
      // for a later direct visit.
      const token = tokenRef.current;
      if (!token) return;
      const committed = `${window.location.pathname}${window.location.search}`;
      if (committed === href) return;
      if (committed === sourcePath || committed.startsWith(`${sourcePath}?`)) return;
      clearMemberEditEntry(token);
    };
  }, [href, sourcePath]);

  return (
    <Link
      href={href}
      className={className}
      onNavigate={() => {
        // Record the ACTUAL source URL, and only when this click really
        // happened on this member's profile. A click from anywhere else (a
        // tab, a stale render) records nothing.
        if (window.location.pathname !== sourcePath) return;
        const originHref = `${window.location.pathname}${window.location.search}`;
        const entry = recordMemberEditEntry({
          namespace,
          memberId,
          facility,
          editHref: href,
          originHref,
        });
        tokenRef.current = entry.token;
      }}
    >
      {children}
    </Link>
  );
}
