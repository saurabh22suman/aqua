"use client";

// Owner light · People lane (3 November 2026) — the member edit HISTORY-ENTRY
// record.
//
// Split out of `member-edit-entry.tsx` (pragmatic SOLID: one module owns the
// browser history-entry metadata and its validation, the other owns the
// one-time in-memory intent and the UI). No runtime cycle: this module knows
// nothing about the in-memory intent.
//
// `history.state` belongs to a browser HISTORY ENTRY. It can survive a reload,
// Back/Forward and browser session restoration; it does not expire at document
// unload. A reload that still carries a valid matching record may therefore
// recover the Back return; only a fresh/new-tab entry with no record, or a
// mismatched/corrupt record, falls back to the plain profile href.
//
// It is UX metadata, NEVER server authorization: it only decides how Cancel
// returns. The record holds bounded IDs, the actor namespace, routes and an
// opaque token — never a name, phone, medical, money or recovery payload.

export type MemberEditExpectation = {
  namespace: string;
  memberId: string;
  facility: string;
  editHref: string;
};

/** What a mount captured: the whole identity, the origin and its own token. */

export function sameMemberEditIdentity(a: MemberEditExpectation, b: MemberEditExpectation): boolean {
  return (
    a.namespace === b.namespace &&
    a.memberId === b.memberId &&
    a.facility === b.facility &&
    a.editHref === b.editHref
  );
}

// ---------------------------------------------------------------------------
// The edit history-entry record.
//
// r8: the normal 30 fast cycles and Keep editing/Discard passed, then Browser
// Forward reopened the edit page and Cancel stalled — the one-time module
// capture is gone on that re-entry. The forward navigation is the same failed
// path, so the edit ENTRY itself carries a bounded record of where it came
// from. This is the app's existing scoped navigation-state pattern
// (`components/members-list-navigation.ts`), not a storage backend: it is
// ordinary `history.state` on this one entry, merged, written with the public
// `replaceState` at the same URL after the edit has committed.
//
// It is UX metadata, NEVER server authorization: it only decides how Cancel
// returns. No person payload, no phone, no name, no financial or recovery data.

export const EDIT_ENTRY_STATE_KEY = "ownerMemberEditEntry";
export const RECORD_VERSION = 1;
const MAX = { token: 128, namespace: 160, id: 64, facility: 64, href: 2048 };

export type MemberEditHistoryRecord = MemberEditExpectation & {
  v: number;
  token: string;
  /** The actual internal profile URL the Edit link was clicked from. */
  sourceHref: string;
};

function bounded(value: unknown, max: number): string | null {
  return typeof value === "string" && value.length > 0 && value.length <= max
    ? value
    : null;
}

function sourcePathOk(sourceHref: string, memberId: string): boolean {
  // Same-origin by construction: a rooted path, never a protocol-relative or
  // absolute URL, and exactly this member's profile path.
  if (!sourceHref.startsWith("/") || sourceHref.startsWith("//")) return false;
  return sourceHref.split("?")[0] === `/owner/members/${memberId}`;
}

/**
 * The facility a URL declares. A missing parameter is canonically "all";
 * duplicate parameters are ambiguous and rejected rather than guessed.
 */
function facilityScopeOf(href: string): { ok: boolean; facility: string | null } {
  const query = href.split("?")[1];
  if (!query) return { ok: true, facility: null };
  const values = new URLSearchParams(query).getAll("facility");
  if (values.length > 1) return { ok: false, facility: null };
  return { ok: true, facility: values[0] ?? null };
}

/** Validate an unknown value into a bounded record, or null. */
export function parseMemberEditHistoryRecord(
  raw: unknown,
): MemberEditHistoryRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (value.v !== RECORD_VERSION) return null;
  const token = bounded(value.token, MAX.token);
  const namespace = bounded(value.namespace, MAX.namespace);
  const memberId = bounded(value.memberId, MAX.id);
  const facility = bounded(value.facility, MAX.facility);
  const editHref = bounded(value.editHref, MAX.href);
  const sourceHref = bounded(value.sourceHref, MAX.href);
  if (!token || !namespace || !memberId || !facility || !editHref || !sourceHref) {
    return null;
  }
  if (!editHref.startsWith(`/owner/members/${memberId}/edit`)) return null;
  // The destination and the source must BOTH declare this record's facility;
  // a source with no facility is canonically "all", and duplicates are
  // ambiguous.
  const editScope = facilityScopeOf(editHref);
  if (!editScope.ok) return null;
  if ((editScope.facility ?? "all") !== facility) return null;
  if (!sourcePathOk(sourceHref, memberId)) return null;
  const sourceScope = facilityScopeOf(sourceHref);
  if (!sourceScope.ok) return null;
  if ((sourceScope.facility ?? "all") !== facility) return null;
  return { v: RECORD_VERSION, token, namespace, memberId, facility, editHref, sourceHref };
}

/** The record on THIS history entry, if it is valid. */
export function readMemberEditHistoryRecord(): MemberEditHistoryRecord | null {
  if (typeof window === "undefined") return null;
  const state = window.history.state;
  if (!state || typeof state !== "object") return null;
  return parseMemberEditHistoryRecord(
    (state as Record<string, unknown>)[EDIT_ENTRY_STATE_KEY],
  );
}

function sameRecord(a: unknown, b: MemberEditHistoryRecord): boolean {
  const parsed = parseMemberEditHistoryRecord(a);
  if (!parsed) return false;
  return (
    parsed.token === b.token &&
    parsed.namespace === b.namespace &&
    parsed.memberId === b.memberId &&
    parsed.facility === b.facility &&
    parsed.editHref === b.editHref &&
    parsed.sourceHref === b.sourceHref
  );
}

/**
 * Merge the record onto the CURRENT history entry at the same URL. Every other
 * state field is preserved, and an identical record is not written again (no
 * StrictMode double write, no re-render loop).
 */
export function writeMemberEditHistoryRecord(record: MemberEditHistoryRecord): void {
  if (typeof window === "undefined") return;
  const state = window.history.state;
  const base = state && typeof state === "object" ? state : {};
  if (sameRecord((base as Record<string, unknown>)[EDIT_ENTRY_STATE_KEY], record)) {
    return;
  }
  window.history.replaceState(
    { ...base, [EDIT_ENTRY_STATE_KEY]: record },
    "",
    window.location.href,
  );
}

/**
 * The origin a REMOUNTED edit may recover from its own history entry — only
 * when the record matches the current props exactly and the browser is on the
 * expected edit destination.
 */
export function resolveHistoryEditReturn(
  expected: MemberEditExpectation | null,
): string | null {
  if (!expected) return null;
  const record = readMemberEditHistoryRecord();
  if (!record) return null;
  if (!sameMemberEditIdentity(record, expected)) return null;
  const current = `${window.location.pathname}${window.location.search}`;
  if (current !== expected.editHref) return null;
  return record.sourceHref;
}

/** Record the intent on the profile's Edit link. */
