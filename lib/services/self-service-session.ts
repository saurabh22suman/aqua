// POSTIMAGE — lib/services/self-service-session.ts  (candidate, NOT applied)
//
// THE PURPOSE-SCOPED SELF-SERVICE SESSION.
//
// ---------------------------------------------------------------------
// THE ONE RULE
// ---------------------------------------------------------------------
//   This credential NEVER creates, upgrades, reads or deletes a
//   better-auth session, and it never writes a `ba_session` row. There is
//   no `auth.api` call in this file, and no membership, role or permission
//   is read or derived anywhere in it. The authority of a scoped session
//   is derived from ITS OWN ROW plus the LIVE linkage rows it names —
//   which is why a role change on a membership cannot reach it, and why an
//   account that is staff in the same club gains nothing here.
//
// ---------------------------------------------------------------------
// THE SCOPES, AND WHY THEY ARE NEVER NESTED
// ---------------------------------------------------------------------
//   `withTenant` and `withUser` are both SQL-scoped scopes and MUST NOT
//   nest (db/scope.ts:49-71). So:
//
//     * the LOCATE step runs under `withUser` — it is the only scope the
//       migration's `for select` user policy admits, and it works only
//       because the cookie carries the account id (P-S1);
//     * every WRITE runs under `withTenant` — the club's own scope, where
//       the rotation index, the revocation path, the binding ledger and
//       the audit row all live (P-S2).
//
//   The two steps are SEQUENTIAL, never nested, and the public
//   `resolveSelfServiceSession` composes them.
//
// ---------------------------------------------------------------------
// THE GATE
// ---------------------------------------------------------------------
//   `authorizeBoundLinks` is THE SEAM: the mint and the per-request
//   recheck both go through it, so the rule cannot drift between them.
//
//   THE NUMBERS NEVER HAVE TO MATCH. When the account's sign-in number
//   differs from the club's record, the pairing stands on the club's own
//   standing staff attestation — an owner's, or a facility-scoped
//   manager's — and on nothing else. The mismatch is NEVER a refusal
//   condition.
//
//   WITH NO ATTESTATION, the account's number IS required: it is the only
//   thing that could establish "this account is the one the club
//   recorded", and an unreadable number fails closed there.
//
//   THE AGE IS NEVER CONSULTED. A linked guardian KEEPS the access after
//   the member turns 18, until an explicit revocation.
//
// ---------------------------------------------------------------------
// 2026-11-09 MEMBER ACTIVATION — WHAT IS NEW IN THIS POSTIMAGE
// ---------------------------------------------------------------------
//   `mintSelfServiceSessionInTx` is the mint, and it takes the CALLER'S
//   transaction. `mintSelfServiceSession` opens its own `withTenant` and
//   delegates to it, so there is exactly ONE mint implementation and the
//   activation can commit the session, the binding ledger and the audit
//   rows together with the credential and the link flip
//   (lib/services/self-service-activation.ts).
//
//   NOTHING ELSE CHANGES. The gate, the rotation, the ledger, the audit
//   rows, the resolver and the touch are byte-identical to the corrected
//   core's postimage.

import { createHash, randomBytes } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { and, eq, inArray, isNull, lt, or } from "drizzle-orm";
import { withTenant, withUser, type TenantTx } from "@/db/tenant";
import { tenants } from "@/db/schema/tenants";
import { OPERATIONAL_TENANT_STATUSES } from "@/db/platform";
import { writeAudit } from "@/lib/audit/write";
import {
  selfServiceAudience,
  selfServiceSessionLinks,
  selfServiceSessions,
  type SelfServiceAudience,
} from "@/db/schema/self-service-session";
import {
  attestationAuthorityStands,
  readLinkAuthorities,
} from "@/lib/services/member-link-authority";
import {
  clubRecordIsCurrent,
  readLinkFacts,
} from "@/lib/services/self-service-link-facts";
import {
  asPersonId,
  asUserId,
  type PersonId,
  type TenantId,
  type UserId,
} from "@/lib/ids";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The cookie. Host-only, httpOnly, no `Domain` attribute, so it is never
// sent to the ops host and a subdomain cannot shadow it
// (lib/auth/platform-cookie.ts is the repository's own convention).
export const SELF_SERVICE_COOKIE = "aqua_self_session";

// THE PURPOSE MARKER. It is the FIRST segment of the cookie and the
// parser REQUIRES it.
export const SELF_SERVICE_COOKIE_PREFIX = "s1";

// THE LIFETIME. These are SERVICE PARAMETERS, not schema facts: the
// table's CHECK is only `expires_at > issued_at`, and both columns stay
// writable on a live row. Their values are the reviewed packet's
// defaults and they are named as a residual in the handoff.
export const SELF_SERVICE_SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
export const SELF_SERVICE_IDLE_SECONDS = 24 * 60 * 60;

// The coarse touch: at most one `last_seen_at` write per this many
// seconds. The write carries its own predicate, so the service — not the
// caller — is the authority.
export const SELF_SERVICE_TOUCH_INTERVAL_SECONDS = 15 * 60;

export function selfServiceCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
    // NO Domain attribute: host-only.
  };
}

// ---------------------------------------------------------------------
// THE CREDENTIAL
// ---------------------------------------------------------------------

/**
 * The stored secret.
 *
 * A SHA-256 over the WHOLE cookie value, in lowercase hex — which is
 * exactly what the table's own CHECK demands
 * (`token_hash ~ '^[0-9a-f]{64}$'`). The cookie value and the secret are
 * never stored.
 */
export function hashSelfServiceToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function buildSelfServiceCookieValue(
  userId: string,
  secret: string,
): string {
  return `${SELF_SERVICE_COOKIE_PREFIX}.${userId}.${secret}`;
}

export type SelfServiceCookieParts = { userId: string; secret: string };

/**
 * Parses the cookie.
 *
 * P-S1: the account id is in the clear, because the door must know which
 * account it is reading before it can arm either RLS policy.
 *
 * A malformed cookie is REFUSED, never repaired and never guessed at.
 */
export function parseSelfServiceCookie(
  value: string | null | undefined,
): SelfServiceCookieParts | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const parts = value.split(".");
  if (parts.length !== 3) return null;
  const [marker, userId, secret] = parts as [string, string, string];
  if (marker !== SELF_SERVICE_COOKIE_PREFIX) return null;
  if (!UUID_RE.test(userId)) return null;
  if (secret.length < 32) return null;
  return { userId, secret };
}

/**
 * The binding digest.
 *
 * A SHA-256 over a canonical string — NOT an HMAC and NOT a secret. It
 * is an EQUALITY check: it proves the live bound set still equals the
 * bound set, nothing more.
 */
export function bindingDigest(args: {
  tenantId: string;
  userId: string;
  audience: SelfServiceAudience;
  subjectId: string | null;
  linkIds: string[];
}): string {
  const canonical = JSON.stringify({
    t: args.tenantId,
    u: args.userId,
    a: args.audience,
    s: args.subjectId,
    l: [...args.linkIds].sort(),
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function isSelfServiceAudience(
  value: unknown,
): value is SelfServiceAudience {
  return (
    typeof value === "string" &&
    (selfServiceAudience as readonly string[]).includes(value)
  );
}

// ---------------------------------------------------------------------
// THE SCOPE — AND WHAT IT DELIBERATELY DOES NOT CARRY
// ---------------------------------------------------------------------

/**
 * The authority a scoped session carries.
 *
 * There is NO role, NO membership and NO permission in this type, and
 * none is read anywhere in this file. An account that is staff in the
 * same club holds this scope too, and gains nothing by it.
 */
export type SelfServiceScope = {
  sessionId: string;
  tenantId: TenantId;
  userId: UserId;
  audience: SelfServiceAudience;
  /** The membership the session is ABOUT (the member audience only). */
  subjectId: string | null;
  /** The person the session acts as: the member's, or the guardian's. */
  personId: PersonId | null;
  /** The link ids this session is bound to. */
  linkIds: readonly string[];
  issuedAt: Date;
  expiresAt: Date;
};

// ---------------------------------------------------------------------
// THE REFUSAL VOCABULARY
// ---------------------------------------------------------------------

export type SelfServiceRefusalReason =
  | "tenant_not_live"
  | "malformed_cookie"
  | "unknown_session"
  | "audience_mismatch"
  | "revoked"
  | "expired"
  | "idle_expired"
  | "binding_empty"
  | "binding_mismatch"
  | "link_missing"
  | "link_not_live"
  | "relationship_not_live"
  | "identity_not_confirmed"
  | "account_number_unreadable"
  | "attestation_authority_lapsed"
  | "subject_mismatch";

/**
 * The one error this module throws.
 *
 * The reason is for the SERVER's own log and audit trail. The door maps
 * EVERY refusal — including this one — to the same byte-identical
 * generic 401, because a distinguishable answer is an oracle.
 */
export class SelfServiceAuthorizationError extends Error {
  readonly reason: SelfServiceRefusalReason;

  constructor(reason: SelfServiceRefusalReason, message?: string) {
    super(message ?? `self-service session refused: ${reason}`);
    this.name = "SelfServiceAuthorizationError";
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------
// THE LINK AUTHORIZATION — THE ONE SEAM
// ---------------------------------------------------------------------

export type AuthorizedLink = {
  linkId: string;
  memberId: string | null;
  personId: string | null;
};

/**
 * GATE 2 — DOES THE PAIRING STAND?
 *
 * THE ORDER IS THE RULE. A STANDING, STILL-AUTHORISED ATTESTATION
 * CARRIES THE PAIRING ON ITS OWN: the account's number is NOT
 * independently required on that branch, is NOT re-read, and is NOT
 * compared. The attestation is a STAFF ATTESTATION ABOUT A PAIRING — it
 * carries NO number, not the member's, not the account's, not a hash of
 * either — so requiring a number afterwards would be requiring a SECOND,
 * INDEPENDENT FACT that the human's rule does not impose.
 *
 * THE ACCOUNT'S NUMBER IS STILL ESSENTIAL ON THE UN-ATTESTED BRANCH, and
 * an unreadable number is a refusal there.
 */
function gate2PairingStands(args: {
  recordedPhone: string | null;
  accountPhone: string | null;
  attestationStands: boolean;
}): boolean {
  if (args.attestationStands) return true;
  if (args.recordedPhone === null || args.accountPhone === null) return false;
  return args.accountPhone === args.recordedPhone;
}

/**
 * THE SEAM. The mint and the per-request recheck BOTH go through here,
 * so the rule cannot drift between them.
 */
type BoundLinkArgs = {
  tenantId: TenantId;
  userId: UserId;
  audience: SelfServiceAudience;
  linkIds: string[];
  accountPhone: string | null;
  subjectId?: string | null;
};

async function authorizeBoundLinksInternal(
  tx: TenantTx,
  args: BoundLinkArgs,
  allowDeletedChildForOmission: boolean,
): Promise<
  | { ok: true; links: AuthorizedLink[] }
  | { ok: false; reason: SelfServiceRefusalReason }
> {
  if (args.linkIds.length === 0) {
    return { ok: false, reason: "binding_empty" };
  }

  const [tenant] = await tx.select({ id: tenants.id }).from(tenants)
    .where(and(eq(tenants.id, args.tenantId),
      inArray(tenants.status, [...OPERATIONAL_TENANT_STATUSES])))
    .limit(1).for("share");
  if (!tenant) return { ok: false, reason: "tenant_not_live" };

  const facts = await readLinkFacts(tx, {
    tenantId: args.tenantId,
    userId: args.userId,
    audience: args.audience,
    linkIds: args.linkIds,
  });

  // A bound link id that names no row of THIS account in THIS club.
  if (facts.length !== args.linkIds.length) {
    return { ok: false, reason: "link_missing" };
  }

  // THE CONFIRMERS' PROVENANCE — resolved ONCE for the whole request,
  // inside this transaction, in this club's scope.
  const confirmerIds = [
    ...new Set(
      facts
        .filter((f) => f.attestationQuartetPresent)
        .map((f) => f.attestationConfirmerUserId)
        .filter((v): v is string => v !== null),
    ),
  ];
  const authorities = await readLinkAuthorities(tx, {
    tenantId: args.tenantId,
    userIds: confirmerIds,
  });

  for (const fact of facts) {
    if (!fact.linkIsLive) {
      return { ok: false, reason: "link_not_live" };
    }
    if (!fact.relationshipIsLive && !(allowDeletedChildForOmission && args.audience === "guardian" && fact.childPersonSoftDeleted)) {
      return { ok: false, reason: "relationship_not_live" };
    }
    // GATE 1 — THE CLUB'S RECORD FOR THIS PERSON. NEVER OVERRIDABLE.
    if (!clubRecordIsCurrent(fact.recordedPhone, fact.personPhone)) {
      return { ok: false, reason: "identity_not_confirmed" };
    }
    const confirmer = fact.attestationConfirmerUserId;
    const attestationStands = attestationAuthorityStands({
      quartetPresent: fact.attestationQuartetPresent,
      confirmerUserId: confirmer,
      basis: fact.attestationBasis,
      facilityId: fact.attestationFacilityId,
      authority: confirmer === null ? undefined : authorities.get(confirmer),
    });

    if (
      !gate2PairingStands({
        recordedPhone: fact.recordedPhone,
        accountPhone: args.accountPhone,
        attestationStands,
      })
    ) {
      // "The confirmer's authority has lapsed" and "this pairing was never
      // confirmed" are DIFFERENT OPERATIONAL FACTS, and the second one
      // must not be reported when the first one is the cause.
      const attestationWasTheOnlyCandidate =
        fact.attestationQuartetPresent &&
        !attestationStands &&
        (args.accountPhone === null ||
          args.accountPhone !== fact.recordedPhone);

      return {
        ok: false,
        reason: attestationWasTheOnlyCandidate
          ? "attestation_authority_lapsed"
          : args.accountPhone === null
            ? "account_number_unreadable"
            : "identity_not_confirmed",
      };
    }
  }

  // THE MEMBER AUDIENCE IS ABOUT ONE MEMBERSHIP. The link's own member
  // id must be the session's subject.
  if (args.audience === "member") {
    if (facts.length !== 1) {
      return { ok: false, reason: "subject_mismatch" };
    }
    if (!facts[0].memberId || facts[0].memberId !== (args.subjectId ?? null)) {
      return { ok: false, reason: "subject_mismatch" };
    }
  }

  return {
    ok: true,
    links: facts.map((f) => ({
      linkId: f.linkId,
      memberId: f.memberId,
      personId: f.personId,
    })),
  };
}

/** The public authority gate never permits a deleted child. */
export function authorizeBoundLinks(tx: TenantTx, args: BoundLinkArgs) {
  return authorizeBoundLinksInternal(tx, args, false);
}

/** Validate omitted guardian links' unchanged identity gates; return no authority. */
export async function validateOmittedGuardianLinks(
  tx: TenantTx,
  args: { tenantId: TenantId; userId: UserId; linkIds: string[]; accountPhone: string | null },
): Promise<boolean> {
  if (!args.linkIds.length) return true;
  const facts = await readLinkFacts(tx, { ...args, audience: "guardian" });
  if (facts.length !== args.linkIds.length || !facts.every((f) => f.childPersonSoftDeleted)) return false;
  const result = await authorizeBoundLinksInternal(tx, { ...args, audience: "guardian" }, true);
  return result.ok;
}

// ---------------------------------------------------------------------
// THE MINT
// ---------------------------------------------------------------------

export type MintSelfServiceSessionInput = {
  tenantId: TenantId;
  userId: UserId;
  audience: SelfServiceAudience;
  /** The membership the session is ABOUT. Required for the member
   *  audience, forbidden for the guardian audience (the table's CHECK). */
  subjectId: string | null;
  /** The link rows this session binds. At least one. */
  linkIds: string[];
  /**
   * The caller's read of the ACCOUNT's sign-in number. `null` means
   * "unreadable".
   *
   * IT IS NOT INDEPENDENTLY REQUIRED. With a standing, still-authorised
   * attestation on the link, the pairing stands WITHOUT it — the
   * attestation confirms the pairing, and it never confirmed a number.
   * Without an attestation the number IS required, and `null` is a
   * refusal.
   */
  accountPhone: string | null;
  requestId?: string | null;
};

/**
 * Mints a scoped session INSIDE THE CALLER'S TRANSACTION, and rotates
 * the previous one.
 *
 * ONE TRANSACTION, in the club's own scope. The rotation, the insert, the
 * binding ledger and the audit rows commit together or not at all:
 *
 *   * a FAILED mint leaves the previous session LIVE. A member is never
 *     signed out by a failure;
 *   * the deferred constraint trigger
 *     (`self_service_sessions_require_binding`) runs at COMMIT and sees
 *     the ledger rows, because the mint is inside `withTenant()` — under
 *     `withUser()` it would see no binding rows and refuse a good mint;
 *   * the unique partial index `self_service_sessions_live_uidx` is the
 *     backstop for two concurrent mints: the loser raises 23505 and its
 *     whole transaction — including its rotation — rolls back.
 *
 * THE ROTATION IS REVOKE-THEN-INSERT, IN ONE TRANSACTION. The live index
 * is a partial UNIQUE INDEX and cannot be deferred, so inserting first
 * would raise a unique violation. The rotation's predicate is
 * `revoked_at is null`, which also covers an EXPIRED but unrevoked row:
 * an expired session holds the live slot until it is revoked, and the
 * mint is what displaces it.
 *
 * THE PERSON IS DERIVED, NEVER SUPPLIED. The session's person comes from
 * the link's own facts, and the migration's deferred trigger refuses a
 * session whose subject member is not that person.
 *
 * THE CALLER OWNS THE TRANSACTION. The caller is the activation, which
 * commits the credential, the link flip, the single-use consume, this
 * session and every audit row together — or none of them.
 */
export async function mintSelfServiceSessionInTx(
  tx: TenantTx,
  input: MintSelfServiceSessionInput,
): Promise<{ cookieValue: string; expiresAt: Date; sessionId: string }> {
  if (!isSelfServiceAudience(input.audience)) {
    throw new SelfServiceAuthorizationError("audience_mismatch");
  }
  if (input.linkIds.length === 0) {
    throw new SelfServiceAuthorizationError("binding_empty");
  }
  if ((input.audience === "member") !== (input.subjectId !== null)) {
    throw new SelfServiceAuthorizationError("subject_mismatch");
  }

  const secret = newSecret();
  const cookieValue = buildSelfServiceCookieValue(input.userId, secret);
  const tokenHash = hashSelfServiceToken(cookieValue);
  const linkIds = [...new Set(input.linkIds)].sort();
  const sessionId = uuidv7();
  const issuedAt = new Date();
  const expiresAt = new Date(
    issuedAt.getTime() + SELF_SERVICE_SESSION_TTL_SECONDS * 1000,
  );
  const actor = asUserId(input.userId);

  const authorized = await authorizeBoundLinks(tx, {
    tenantId: input.tenantId,
    userId: input.userId,
    audience: input.audience,
    linkIds,
    accountPhone: input.accountPhone,
    subjectId: input.subjectId,
  });
  if (!authorized.ok) {
    throw new SelfServiceAuthorizationError(authorized.reason);
  }

  const personId = authorized.links[0]?.personId ?? null;
  if (personId === null) {
    throw new SelfServiceAuthorizationError("relationship_not_live");
  }

  const digest = bindingDigest({
    tenantId: input.tenantId,
    userId: input.userId,
    audience: input.audience,
    subjectId: input.subjectId,
    linkIds,
  });

  // THE ROTATION. The predicate carries `revoked_at is null`, so an
  // already-revoked row is never written again and never re-attributed.
  const rotated = await tx
    .update(selfServiceSessions)
    .set({ revokedAt: issuedAt, revokedByUserId: actor })
    .where(
      and(
        eq(selfServiceSessions.tenantId, input.tenantId),
        eq(selfServiceSessions.userId, input.userId),
        eq(selfServiceSessions.audience, input.audience),
        isNull(selfServiceSessions.revokedAt),
      ),
    )
    .returning({ id: selfServiceSessions.id });

  await tx.insert(selfServiceSessions).values({
    id: sessionId,
    tenantId: input.tenantId,
    userId: input.userId,
    personId: asPersonId(personId),
    audience: input.audience,
    subjectId: input.subjectId,
    bindingDigest: digest,
    tokenHash,
    issuedAt,
    expiresAt,
    lastSeenAt: issuedAt,
  });

  // THE LEDGER. The AUDIENCE DECIDES THE LINK KIND, and the table's
  // CHECK makes exactly one of the two columns set.
  await tx.insert(selfServiceSessionLinks).values(
    linkIds.map((linkId) => ({
      id: uuidv7(),
      sessionId,
      tenantId: input.tenantId,
      audience: input.audience,
      userId: input.userId,
      memberLinkId: input.audience === "member" ? linkId : null,
      guardianLinkId: input.audience === "guardian" ? linkId : null,
      createdAt: issuedAt,
    })),
  );

  // THE AUDIT ROWS, IN THE SAME TRANSACTION. No token, no cookie value,
  // no secret and no phone number is ever written to them.
  for (const row of rotated) {
    await writeAudit(tx, {
      tenantId: input.tenantId,
      actorType: "user",
      actorId: actor,
      action: "self.session.revoked",
      entityType: "self_service_session",
      entityId: row.id,
      before: { revokedAt: null },
      after: {
        revokedAt: issuedAt.toISOString(),
        revokedByUserId: input.userId,
        reason: "rotated_by_sign_in",
      },
      changedFields: ["revoked_at", "revoked_by_user_id"],
      requestId: input.requestId ?? null,
    });
  }

  await writeAudit(tx, {
    tenantId: input.tenantId,
    actorType: "user",
    actorId: actor,
    action: "self.session.minted",
    entityType: "self_service_session",
    entityId: sessionId,
    after: {
      sessionId,
      audience: input.audience,
      subjectId: input.subjectId,
      linkIds,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    },
    changedFields: null,
    requestId: input.requestId ?? null,
  });

  return { cookieValue, expiresAt, sessionId };
}

/**
 * Mints a scoped session in the club's own scope, and rotates the
 * previous one.
 *
 * IT OPENS ITS OWN TRANSACTION and delegates to
 * `mintSelfServiceSessionInTx`. A caller that already owns a tenant
 * transaction — the activation — calls the in-tx variant instead, so the
 * session commits with the rest of the activation.
 */
export async function mintSelfServiceSession(
  input: MintSelfServiceSessionInput,
): Promise<{ cookieValue: string; expiresAt: Date; sessionId: string }> {
  return withTenant(input.tenantId, (tx) =>
    mintSelfServiceSessionInTx(tx, input),
  );
}

// ---------------------------------------------------------------------
// THE RESOLVE — THE PER-REQUEST RECHECK
// ---------------------------------------------------------------------

export type SelfServiceResolveResult =
  | { ok: true; scope: SelfServiceScope }
  | { ok: false; reason: SelfServiceRefusalReason };

export type ResolveSelfServiceSessionInput = {
  /** The cookie value. Required by the composed resolver; the in-transaction
   *  half never reads it. */
  cookieValue?: string | null | undefined;
  /**
   * The caller's read of the account's sign-in number. `null` means
   * "unreadable". The same meaning as in the mint.
   */
  accountPhone: string | null;
  /** The surface's audience. A member cookie may not open the guardian
   *  surface and the other way round. */
  expectedAudience?: SelfServiceAudience;
  now?: Date;
  requestId?: string | null;
};

export type LocatedSelfServiceSession = {
  id: string;
  tenantId: TenantId;
  userId: UserId;
  audience: SelfServiceAudience;
  subjectId: string | null;
  bindingDigest: string;
  issuedAt: Date;
  expiresAt: Date;
  lastSeenAt: Date;
  revokedAt: Date | null;
};

/**
 * STEP 1 — LOCATE THE ROW, UNDER `withUser`.
 *
 * Only the migration's `for select` user policy admits this read, and
 * only because the cookie carries the account id (P-S1). WITHOUT THAT
 * POLICY THIS READ RETURNS ZERO ROWS AND EVERY REQUEST FAILS CLOSED.
 */
export async function locateSelfServiceSession(
  cookieValue: string | null | undefined,
): Promise<
  | { ok: true; session: LocatedSelfServiceSession }
  | { ok: false; reason: SelfServiceRefusalReason }
> {
  const parsed = parseSelfServiceCookie(cookieValue);
  if (!parsed || typeof cookieValue !== "string") {
    return { ok: false, reason: "malformed_cookie" };
  }
  const tokenHash = hashSelfServiceToken(cookieValue);
  const accountId = asUserId(parsed.userId);

  const located = await withUser(parsed.userId, async (tx) => {
    const rows = await tx
      .select({
        id: selfServiceSessions.id,
        tenantId: selfServiceSessions.tenantId,
        userId: selfServiceSessions.userId,
        audience: selfServiceSessions.audience,
        subjectId: selfServiceSessions.subjectId,
        bindingDigest: selfServiceSessions.bindingDigest,
        issuedAt: selfServiceSessions.issuedAt,
        expiresAt: selfServiceSessions.expiresAt,
        lastSeenAt: selfServiceSessions.lastSeenAt,
        revokedAt: selfServiceSessions.revokedAt,
      })
      .from(selfServiceSessions)
      .where(
        and(
          eq(selfServiceSessions.tokenHash, tokenHash),
          eq(selfServiceSessions.userId, accountId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  });

  if (!located) return { ok: false, reason: "unknown_session" };
  if (!isSelfServiceAudience(located.audience)) {
    return { ok: false, reason: "audience_mismatch" };
  }
  return { ok: true, session: located };
}

/**
 * STEP 2 — THE AUTHORITATIVE READ, INSIDE `withTenant`.
 *
 * The row, the binding ledger, the live link rows, the digest, the gates
 * and the touch, all in ONE transaction, in the club's own scope.
 *
 * It takes a TRANSACTION so that a caller which already owns one (the
 * scope resolver, which must run the recheck and the data read in the
 * SAME transaction) can call it without opening a second, nested scope.
 */
export async function resolveSelfServiceSessionInTx(
  tx: TenantTx,
  located: LocatedSelfServiceSession,
  input: ResolveSelfServiceSessionInput,
): Promise<SelfServiceResolveResult> {
  const now = input.now ?? new Date();

  if (input.expectedAudience && located.audience !== input.expectedAudience) {
    return { ok: false, reason: "audience_mismatch" };
  }

  // Serialize readers before a possible idle-timestamp UPDATE; two SHARE
  // holders upgrading the same row would deadlock during a coarse touch.
  const rows = await tx
    .select({
      id: selfServiceSessions.id,
      tenantId: selfServiceSessions.tenantId,
      userId: selfServiceSessions.userId,
      audience: selfServiceSessions.audience,
      subjectId: selfServiceSessions.subjectId,
      personId: selfServiceSessions.personId,
      bindingDigest: selfServiceSessions.bindingDigest,
      issuedAt: selfServiceSessions.issuedAt,
      expiresAt: selfServiceSessions.expiresAt,
      lastSeenAt: selfServiceSessions.lastSeenAt,
      revokedAt: selfServiceSessions.revokedAt,
    })
    .from(selfServiceSessions)
    .where(
      and(
        eq(selfServiceSessions.id, located.id),
        eq(selfServiceSessions.tenantId, located.tenantId),
        eq(selfServiceSessions.userId, located.userId),
      ),
    )
    .for("update");

  const row = rows[0] ?? null;
  if (!row) return { ok: false, reason: "unknown_session" };
  if (row.revokedAt !== null) return { ok: false, reason: "revoked" };
  if (row.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }
  if (
    row.lastSeenAt.getTime() <
    now.getTime() - SELF_SERVICE_IDLE_SECONDS * 1000
  ) {
    return { ok: false, reason: "idle_expired" };
  }

  // The ledger is immutable to app_user (UPDATE/DELETE are revoked).
  // FOR SHARE would require UPDATE privilege and reject every valid read.
  // The parent session and live link rows keep their existing row locks.
  const ledger = await tx
    .select({
      memberLinkId: selfServiceSessionLinks.memberLinkId,
      guardianLinkId: selfServiceSessionLinks.guardianLinkId,
    })
    .from(selfServiceSessionLinks)
    .where(
      and(
        eq(selfServiceSessionLinks.sessionId, row.id),
        eq(selfServiceSessionLinks.tenantId, row.tenantId),
        eq(selfServiceSessionLinks.audience, row.audience),
        eq(selfServiceSessionLinks.userId, row.userId),
      ),
    );

  const boundLinkIds = ledger
    .map((l) => (row.audience === "member" ? l.memberLinkId : l.guardianLinkId))
    .filter((v): v is string => v !== null)
    .sort();

  if (boundLinkIds.length === 0) {
    return { ok: false, reason: "binding_empty" };
  }

  const authorized = await authorizeBoundLinks(tx, {
    tenantId: row.tenantId,
    userId: row.userId,
    audience: row.audience,
    linkIds: boundLinkIds,
    accountPhone: input.accountPhone,
    subjectId: row.subjectId,
  });
  if (!authorized.ok) {
    return { ok: false, reason: authorized.reason };
  }

  // THE DIGEST, RECOMPUTED OVER THE LIVE BOUND SET. A widened or a
  // narrowed ledger changes the set, the recomputed digest no longer
  // matches the stored one, and the session is refused.
  const digest = bindingDigest({
    tenantId: row.tenantId,
    userId: row.userId,
    audience: row.audience,
    subjectId: row.subjectId,
    linkIds: boundLinkIds,
  });
  if (digest !== row.bindingDigest) {
    return { ok: false, reason: "binding_mismatch" };
  }

  // THE COARSE TOUCH, in the same transaction and the same scope, and
  // ONLY after every check has passed — a refused request must not
  // refresh the idle window.
  await touchInTx(tx, {
    tenantId: row.tenantId,
    sessionId: row.id,
    now,
  });

  return {
    ok: true,
    scope: {
      sessionId: row.id,
      tenantId: row.tenantId,
      userId: row.userId,
      audience: row.audience,
      subjectId: row.subjectId,
      personId: row.personId ? asPersonId(row.personId) : null,
      linkIds: boundLinkIds,
      issuedAt: row.issuedAt,
      expiresAt: row.expiresAt,
    },
  };
}

/**
 * Resolves a cookie into an authority, or refuses.
 *
 * TWO SCOPES, IN SEQUENCE, NEVER NESTED.
 *
 * EVERY REFUSAL IS THE SAME ANSWER TO THE CALLER. The distinction
 * between the reasons exists for the server's log and the audit trail,
 * never for the response.
 */
export async function resolveSelfServiceSession(
  input: ResolveSelfServiceSessionInput,
): Promise<SelfServiceResolveResult> {
  const located = await locateSelfServiceSession(input.cookieValue);
  if (!located.ok) return { ok: false, reason: located.reason };

  return withTenant(located.session.tenantId, async (tx) =>
    resolveSelfServiceSessionInTx(tx, located.session, input),
  );
}

// ---------------------------------------------------------------------
// THE TOUCH
// ---------------------------------------------------------------------

/**
 * The coarse touch.
 *
 * ATOMIC: the write carries its own `last_seen_at < cutoff` predicate,
 * so two concurrent requests cannot both write. The service — not the
 * caller — is the authority.
 */
async function touchInTx(
  tx: TenantTx,
  args: { tenantId: TenantId; sessionId: string; now: Date },
): Promise<void> {
  const cutoff = new Date(
    args.now.getTime() - SELF_SERVICE_TOUCH_INTERVAL_SECONDS * 1000,
  );
  await tx
    .update(selfServiceSessions)
    .set({ lastSeenAt: args.now })
    .where(
      and(
        eq(selfServiceSessions.id, args.sessionId),
        eq(selfServiceSessions.tenantId, args.tenantId),
        isNull(selfServiceSessions.revokedAt),
        lt(selfServiceSessions.lastSeenAt, cutoff),
      ),
    );
}

/**
 * Touches a session from OUTSIDE an open tenant transaction.
 *
 * It opens its own `withTenant`, so it must NOT be called from inside
 * one: `withTenant` cannot nest inside `withTenant` (db/scope.ts:49-71)
 * and the call would throw. Inside the resolve path the private
 * `touchInTx` is used instead.
 */
export async function touchSelfServiceSession(input: {
  tenantId: TenantId;
  sessionId: string;
  now?: Date;
}): Promise<void> {
  const now = input.now ?? new Date();
  await withTenant(input.tenantId, (tx) =>
    touchInTx(tx, {
      tenantId: input.tenantId,
      sessionId: input.sessionId,
      now,
    }),
  );
}

// ---------------------------------------------------------------------
// THE REVOCATIONS
// ---------------------------------------------------------------------

export type RevokeSelfServiceSessionInput = {
  tenantId: TenantId;
  sessionId: string;
  /**
   * THE ACTOR IS NEVER NULL. The table's own CHECK is
   * `revoked_at is null or revoked_by_user_id is not null`, so a
   * revocation that passed null would RAISE the check instead of
   * revoking the row.
   */
  revokedByUserId: UserId;
  requestId?: string | null;
};

/**
 * Revokes one session. Idempotent.
 *
 * READ FIRST, WRITE ONCE: the predicate carries `revoked_at is null`, so
 * an already-revoked session is never written again and never
 * re-attributed. That is also what keeps the path compatible with the
 * migration's immutability guard, which refuses a second write with a
 * different moment or a different actor.
 */
export async function revokeSelfServiceSession(
  input: RevokeSelfServiceSessionInput,
): Promise<boolean> {
  const revokedAt = new Date();
  return withTenant(input.tenantId, async (tx) => {
    const rows = await tx
      .update(selfServiceSessions)
      .set({ revokedAt, revokedByUserId: input.revokedByUserId })
      .where(
        and(
          eq(selfServiceSessions.id, input.sessionId),
          eq(selfServiceSessions.tenantId, input.tenantId),
          isNull(selfServiceSessions.revokedAt),
        ),
      )
      .returning({ id: selfServiceSessions.id });

    if (rows.length === 0) return false;

    await writeAudit(tx, {
      tenantId: input.tenantId,
      actorType: "user",
      actorId: input.revokedByUserId,
      action: "self.session.revoked",
      entityType: "self_service_session",
      entityId: rows[0].id,
      before: { revokedAt: null },
      after: {
        revokedAt: revokedAt.toISOString(),
        revokedByUserId: input.revokedByUserId,
        reason: "explicit_revoke",
      },
      changedFields: ["revoked_at", "revoked_by_user_id"],
      requestId: input.requestId ?? null,
    });

    return true;
  });
}

/**
 * Revokes every live session bound to a set of link rows.
 *
 * THE JOIN, NOT THE ARRAY. It opens its own tenant scope, so it must be
 * called AFTER the link flip has committed, not inside that transaction.
 * The load-bearing control is the per-request recheck, which observes
 * the flipped row under `FOR SHARE` and fails closed; this is DEFENCE IN
 * DEPTH.
 */
export async function revokeSelfServiceSessionsForLinks(input: {
  tenantId: TenantId;
  linkIds: string[];
  revokedByUserId: UserId;
  requestId?: string | null;
}): Promise<number> {
  if (input.linkIds.length === 0) return 0;
  const revokedAt = new Date();

  return withTenant(input.tenantId, async (tx) => {
    const bound = await tx
      .select({ id: selfServiceSessions.id })
      .from(selfServiceSessions)
      .innerJoin(
        selfServiceSessionLinks,
        and(
          eq(selfServiceSessionLinks.sessionId, selfServiceSessions.id),
          eq(selfServiceSessionLinks.tenantId, selfServiceSessions.tenantId),
        ),
      )
      .where(
        and(
          eq(selfServiceSessions.tenantId, input.tenantId),
          isNull(selfServiceSessions.revokedAt),
          or(
            inArray(selfServiceSessionLinks.memberLinkId, input.linkIds),
            inArray(selfServiceSessionLinks.guardianLinkId, input.linkIds),
          ),
        ),
      );

    if (bound.length === 0) return 0;

    const rows = await tx
      .update(selfServiceSessions)
      .set({ revokedAt, revokedByUserId: input.revokedByUserId })
      .where(
        and(
          eq(selfServiceSessions.tenantId, input.tenantId),
          inArray(
            selfServiceSessions.id,
            bound.map((b) => b.id),
          ),
          isNull(selfServiceSessions.revokedAt),
        ),
      )
      .returning({ id: selfServiceSessions.id });

    for (const row of rows) {
      await writeAudit(tx, {
        tenantId: input.tenantId,
        actorType: "user",
        actorId: input.revokedByUserId,
        action: "self.session.revoked",
        entityType: "self_service_session",
        entityId: row.id,
        before: { revokedAt: null },
        after: {
          revokedAt: revokedAt.toISOString(),
          revokedByUserId: input.revokedByUserId,
          reason: "link_revoked",
        },
        changedFields: ["revoked_at", "revoked_by_user_id"],
        requestId: input.requestId ?? null,
      });
    }

    return rows.length;
  });
}
