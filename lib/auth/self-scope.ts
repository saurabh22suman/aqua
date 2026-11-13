// POSTIMAGE — lib/auth/self-scope.ts  (candidate, NOT applied)
//
// THE SELF-SERVICE SCOPE.
//
// TWO CREDENTIAL KINDS, ONE SCOPE.
//
//   kind "self_session"  -- the purpose-scoped cookie. The scope is the
//                           session's BOUND rows, re-read live.
//   kind "staff_session" -- the account's existing better-auth session,
//                           honoured ONLY because the account holds a live
//                           member or guardian link IN THE TENANT OF ITS
//                           OWN STAFF MEMBERSHIP.
//
// NEITHER KIND PRODUCES AUTHORITY. A scope is a set of linkage rows; it
// grants nothing but the ability to read the member or child data those
// rows name.
//
// THE SCOPE TYPE CARRIES NO ROLE, NO MEMBERSHIP AND NO PERMISSION. The
// scope's SHAPE is the guarantee: a scope that carries a role is a scope
// that can be mistaken for authority.
//
// THE RECHECK IS THE LOAD-BEARING CONTROL. It runs on EVERY request,
// inside the SAME transaction as the data read, and it takes FOR SHARE on
// the bound rows so a concurrent revoke cannot slip through the gap.
//
// THIS MODULE MINTS NOTHING. There is no auth.api.signInEmail, no
// ba_session write and no scoped-session insert in this file. A staff
// session stays a staff session: reading the member surface with it mints
// nothing and changes nothing about it.

import { cookies, headers } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import { withPlatform } from "@/db/scope";
import { withTenant, type TenantTx } from "@/db/tenant";
import { NotFoundError } from "@/lib/auth/context";
import { auth } from "@/lib/auth/server";
import {
  OPERATIONAL_TENANT_STATUSES,
  resolveDefaultMembership,
  resolveTenantAccessBySlug,
} from "@/db/platform";
import { readSelfServiceAccountInTx } from "@/db/self-service-account";
import { tenants } from "@/db/schema/tenants";
import { tenantMemberships } from "@/db/schema/memberships";
import { roles } from "@/db/schema/roles";
import { users } from "@/db/schema/users";
import { isSessionExpiredForRole } from "@/lib/auth/permissions";
import {
  SELF_SERVICE_COOKIE,
  SELF_SERVICE_IDLE_SECONDS,
  authorizeBoundLinks,
  validateOmittedGuardianLinks,
  locateSelfServiceSession,
  resolveSelfServiceSessionInTx,
  type LocatedSelfServiceSession,
} from "@/lib/services/self-service-session";
import {
  readLinkFacts,
  readLiveLinkIds,
} from "@/lib/services/self-service-link-facts";
import { guardianChildLinks, memberAccountLinks } from "@/db/schema/member-self";
import type { SelfServiceAudience } from "@/db/schema/self-service-session";
import {
  asMemberId,
  type MemberId,
  type TenantId,
  type UserId,
} from "@/lib/ids";

export type SelfScope = {
  kind: "self_session" | "staff_session";
  tenantId: TenantId;
  userId: UserId;
  audience: SelfServiceAudience;
  /** The member the scope is bound to (member audience). */
  memberId: MemberId | null;
  /** The children the scope may read (guardian audience). */
  childMemberIds: MemberId[];
  /** The exact linkage rows the scope is bound to. */
  linkIds: string[];
  /** The session row id, when the scope came from a scoped session. */
  sessionId: string | null;
};

export type SelfScopeResolver = {
  /**
   * The PRELIMINARY scope, derived from the credential alone.
   *
   * It is the scope the credential CLAIMS. The AUTHORITATIVE scope is the
   * one handed to the reader inside `read`, after the recheck.
   */
  scope: SelfScope;
  /**
   * Runs `fn` INSIDE the guarded tenant transaction.
   *
   * This is the whole point of the resolver: the recheck and the data
   * read share ONE transaction. If the recheck commits and the data read
   * starts later, a revoke in between is not observed.
   *
   * `fn` is NOT called when the recheck fails; the resolver throws the
   * repository's own NotFoundError instead, which a page turns into
   * notFound() and a route turns into the generic 404.
   */
  read<T>(fn: (tx: TenantTx, scope: SelfScope) => Promise<T>): Promise<T>;
};

/** The scoped session's row, as read under `withUser`. */
export type ScopedSessionRow = LocatedSelfServiceSession;

/** Is the scoped session row still usable? */
export function isLiveSession(session: ScopedSessionRow): boolean {
  if (session.revokedAt) return false;
  if (session.expiresAt.getTime() <= Date.now()) return false;
  if (
    session.lastSeenAt.getTime() <=
    Date.now() - SELF_SERVICE_IDLE_SECONDS * 1000
  ) {
    return false;
  }
  return true;
}

/**
 * The scoped cookie's row.
 *
 * null                    -- there is no scoped cookie at all.
 * { session: null }      -- the cookie is PRESENT but its row is gone
 *                           (dead).
 * { session }             -- the row exists, in whatever state.
 *
 * The distinction matters: a present-but-dead scoped cookie must NOT
 * fall through to the staff branch.
 */
export async function readScopedSession(options?: {
  requireLive?: boolean;
}): Promise<{ rawToken: string; session: ScopedSessionRow | null } | null> {
  const jar = await cookies();
  const rawToken = jar.get(SELF_SERVICE_COOKIE)?.value ?? null;
  if (!rawToken) return null;

  const located = await locateSelfServiceSession(rawToken);
  if (!located.ok) return { rawToken, session: null };
  if (options?.requireLive && !isLiveSession(located.session)) {
    return { rawToken, session: null };
  }
  return { rawToken, session: located.session };
}

/**
 * THE ACCOUNT'S OWN CLUBS -- the cross-tenant derivation.
 *
 * It reads ONLY the account's own linkage rows, and it reads ONLY two
 * columns from them: the linkage row's id and its tenant id. No member
 * id, no person id, no phone number and no subject crosses this
 * boundary.
 *
 * WHY IT EXISTS: the PIN door must name the club a link-only principal
 * is signing in to. The membership is NOT a club enumerator for that
 * population -- a link-only principal has no tenant_memberships row -- so
 * the account's OWN link rows are the only honest source. The read runs
 * under `withUser()`, which sets app.user_id; the linkage tables carry a
 * SELECT-only, user-scoped policy that admits the account's own rows and
 * nothing else.
 *
 * WHAT IT IS NOT: it is a SELECTOR, not an authority. Every row it
 * returns is re-read INSIDE the chosen tenant, with the liveness joins
 * and the recorded-number gate, before anything is minted.
 */
export type AccountLinkClub = {
  tenantId: TenantId;
  audience: SelfServiceAudience;
  linkIds: string[];
};

export async function readAccountLinkClubs(
  tx: TenantTx,
  userId: UserId,
): Promise<AccountLinkClub[]> {
  const memberRows = await tx
    .select({ id: memberAccountLinks.id, tenantId: memberAccountLinks.tenantId })
    .from(memberAccountLinks)
    .where(
      and(
        eq(memberAccountLinks.userId, userId),
        eq(memberAccountLinks.status, "active"),
      ),
    );
  const guardianRows = await tx
    .select({ id: guardianChildLinks.id, tenantId: guardianChildLinks.tenantId })
    .from(guardianChildLinks)
    .where(
      and(
        eq(guardianChildLinks.userId, userId),
        eq(guardianChildLinks.status, "active"),
      ),
    );

  const byClub = new Map<string, AccountLinkClub>();
  const add = (
    tenantId: TenantId,
    audience: SelfServiceAudience,
    id: string,
  ): void => {
    const key = `${tenantId}:${audience}`;
    const existing = byClub.get(key);
    if (existing) {
      existing.linkIds.push(id);
      return;
    }
    byClub.set(key, { tenantId, audience, linkIds: [id] });
  };
  for (const row of memberRows) add(row.tenantId, "member", row.id);
  for (const row of guardianRows) add(row.tenantId, "guardian", row.id);
  return [...byClub.values()];
}

function preliminaryScopedScope(session: ScopedSessionRow): SelfScope {
  return {
    kind: "self_session",
    tenantId: session.tenantId,
    userId: session.userId,
    audience: session.audience,
    memberId:
      session.audience === "member" && session.subjectId
        ? asMemberId(session.subjectId)
        : null,
    childMemberIds: [],
    // The BOUND SET is known only after the recheck: the live set must
    // EQUAL the bound set, and only the recheck can say that.
    linkIds: [],
    sessionId: session.id,
  };
}

/**
 * The resolver for a scoped session.
 *
 * THE TRANSACTION BOUNDARY IS THE WHOLE POINT. The reader runs INSIDE the
 * `withTenant` callback, after the recheck, so the recheck and the data
 * read share one transaction.
 */
export function scopedSelfResolver(
  session: ScopedSessionRow,
  clubSlug: string | null = null,
): SelfScopeResolver {
  const scope = preliminaryScopedScope(session);
  return {
    scope,
    read: async function read<T>(
      fn: (tx: TenantTx, scope: SelfScope) => Promise<T>,
    ): Promise<T> {
      return withTenant(session.tenantId, async (tx) => {
        // THE CLUB ITSELF must still be operational, and the requested
        // club must BE this one. A mismatch resolves to NOTHING -- it
        // never serves this club's data under a foreign club parameter.
        const tenantRows = await tx
          .select({ slug: tenants.slug, status: tenants.status })
          .from(tenants)
          .where(eq(tenants.id, session.tenantId))
          .for("share");
        const tenantRow = tenantRows[0];
        if (!tenantRow) throw new NotFoundError();
        if (
          !(OPERATIONAL_TENANT_STATUSES as readonly string[]).includes(
            tenantRow.status,
          )
        ) {
          throw new NotFoundError();
        }
        if (clubSlug !== null && clubSlug !== tenantRow.slug) {
          throw new NotFoundError();
        }

        // THE ACCOUNT'S NUMBER, read INSIDE this transaction, through the
        // account's own link row. It is part of the same snapshot as the
        // locked linkage rows.
        const account = await readSelfServiceAccountInTx(tx, {
          tenantId: session.tenantId,
          userId: session.userId,
        });
        const accountPhone = account?.phone ?? null;

        const resolved = await resolveSelfServiceSessionInTx(tx, session, {
          accountPhone,
          expectedAudience: session.audience,
        });
        if (!resolved.ok) throw new NotFoundError();

        const facts = await readLinkFacts(tx, {
          tenantId: session.tenantId,
          userId: session.userId,
          audience: session.audience,
          linkIds: [...resolved.scope.linkIds],
        });

        const live: SelfScope = {
          kind: "self_session",
          tenantId: session.tenantId,
          userId: session.userId,
          audience: session.audience,
          memberId:
            session.audience === "member" && resolved.scope.subjectId
              ? asMemberId(resolved.scope.subjectId)
              : null,
          childMemberIds:
            session.audience === "guardian"
              ? facts
                  .map((f) => (f.memberId ? asMemberId(f.memberId) : null))
                  .filter((id): id is MemberId => id !== null)
              : [],
          linkIds: [...resolved.scope.linkIds],
          sessionId: session.id,
        };
        return fn(tx, live);
      });
    },
  };
}

/**
 * The staff branch's resolver.
 *
 * The staff branch has NO bound set -- there is no session row to bind to
 * -- so its scope IS the account's live linkage rows IN THIS TENANT. It
 * reads the same rows, under the same lock, through the same gate.
 *
 * It MINTS NOTHING and it changes nothing about the staff session. A
 * revoked link removes the rows from scope; it does not end the staff
 * session.
 */
function staffSelfResolver(
  tenantId: TenantId,
  userId: UserId,
  audience: SelfServiceAudience,
  clubSlug: string | null,
  authority: { membershipId: string; roleId: string; roleKey: string; sessionCreatedAt: number },
): SelfScopeResolver {
  const scope: SelfScope = {
    kind: "staff_session",
    tenantId,
    userId,
    audience,
    memberId: null,
    childMemberIds: [],
    linkIds: [],
    sessionId: null,
  };
  return {
    scope,
    read: async function read<T>(
      fn: (tx: TenantTx, scope: SelfScope) => Promise<T>,
    ): Promise<T> {
      return withTenant(tenantId, async (tx) => {
        const tenantRows = await tx
          .select({ slug: tenants.slug, status: tenants.status })
          .from(tenants)
          .where(eq(tenants.id, tenantId))
          .for("share");
        const tenantRow = tenantRows[0];
        if (!tenantRow) throw new NotFoundError();
        if (
          !(OPERATIONAL_TENANT_STATUSES as readonly string[]).includes(
            tenantRow.status,
          )
        ) {
          throw new NotFoundError();
        }
        if (clubSlug !== null && clubSlug !== tenantRow.slug) {
          throw new NotFoundError();
        }

        const [membership] = await tx.select({ roleKey: roles.key }).from(tenantMemberships)
          .innerJoin(roles, and(eq(roles.id, tenantMemberships.roleId), eq(roles.tenantId, tenantId)))
          .innerJoin(users, eq(users.id, tenantMemberships.userId))
          .where(and(eq(tenantMemberships.id, authority.membershipId), eq(tenantMemberships.tenantId, tenantId),
            eq(tenantMemberships.userId, userId), eq(tenantMemberships.roleId, authority.roleId),
            eq(tenantMemberships.status, "active"), isNull(tenantMemberships.deletedAt),
            isNull(roles.deletedAt), isNull(users.deletedAt))).for("share");
        if (!membership || membership.roleKey !== authority.roleKey ||
          isSessionExpiredForRole(membership.roleKey, authority.sessionCreatedAt)) throw new NotFoundError();

        const account = await readSelfServiceAccountInTx(tx, {
          tenantId,
          userId,
        });
        const accountPhone = account?.phone ?? null;

        const linkIds = await readLiveLinkIds(tx, {
          tenantId,
          userId,
          audience,
        });
        if (linkIds.length === 0) throw new NotFoundError();

        const facts = await readLinkFacts(tx, {
          tenantId,
          userId,
          audience,
          linkIds,
        });
        if (facts.length !== linkIds.length) throw new NotFoundError();
        // A fresh staff-derived guardian set excludes only a proven
        // soft-deleted child; all remaining links still pass the full gate.
        const omitted = audience === "guardian" ? facts.filter((f) => f.childPersonSoftDeleted).map((f) => f.linkId) : [];
        if (!await validateOmittedGuardianLinks(tx, { tenantId, userId, linkIds: omitted, accountPhone })) throw new NotFoundError();
        const eligible = audience === "guardian" ? facts.filter((f) => !f.childPersonSoftDeleted) : facts;
        const eligibleIds = eligible.map((f) => f.linkId);
        if (!eligibleIds.length) throw new NotFoundError();
        const subjectId =
          audience === "member" ? (eligible[0]?.memberId ?? null) : null;

        const authorized = await authorizeBoundLinks(tx, {
          tenantId,
          userId,
          audience,
          linkIds: eligibleIds,
          accountPhone,
          subjectId,
        });
        if (!authorized.ok) throw new NotFoundError();

        const live: SelfScope = {
          kind: "staff_session",
          tenantId,
          userId,
          audience,
          memberId:
            audience === "member" && subjectId
              ? asMemberId(subjectId)
              : null,
          childMemberIds:
            audience === "guardian"
              ? authorized.links
                  .map((f) => (f.memberId ? asMemberId(f.memberId) : null))
                  .filter((id): id is MemberId => id !== null)
              : [],
          linkIds: [...eligibleIds],
          sessionId: null,
        };
        return fn(tx, live);
      });
    },
  };
}

async function currentBetterAuthUserId(): Promise<{ id: string; createdAt: number } | null> {
  const h = await headers();
  const session = await withPlatform(() =>
    auth.api.getSession({ headers: h }),
  );
  if (!session?.user || !session.session) return null;
  const createdAt = new Date(session.session.createdAt).getTime();
  return Number.isFinite(createdAt) ? { id: session.user.id, createdAt } : null;
}

/**
 * Which club the staff branch is anchored to.
 *
 * WITH ?club=: the live binding -- the account's ACTIVE membership in
 * that club (db/platform.ts).
 *
 * WITHOUT ?club=: the account's OWN club -- the same notion the staff
 * surface already uses (db/platform.ts).
 *
 * NOTE THE TWO CLUB NOTIONS, WHICH MUST NOT BE CONFLATED:
 *   - `clubSlug` is a SLUG. It is a CHECK, never a lookup: the tenant
 *     row's own slug is compared inside the transaction.
 *   - the PIN door's `clubId` is the club's TENANT ID. It is a SELECTOR
 *     for the door's club derivation, and it is validated against the
 *     derived entitlement set before anything is minted.
 */
async function resolveStaffTenant(
  betterAuthUserId: string,
  clubSlug: string | null,
): Promise<{ tenantId: TenantId; userId: UserId; membershipId: string; roleId: string; roleKey: string } | null> {
  if (clubSlug !== null) {
    const access = await resolveTenantAccessBySlug(betterAuthUserId, clubSlug);
    if (!access) return null;
    return access;
  }
  const membership = await resolveDefaultMembership(betterAuthUserId);
  if (!membership || membership.requiresSelection) return null;
  return membership;
}

/**
 * Resolve the self-service scope for a request.
 *
 * THE SCOPED COOKIE FIRST. A present-but-dead scoped cookie does NOT
 * fall through to the staff branch: the holder asked for the self-service
 * door, and a dead scoped credential must not silently become a staff
 * credential.
 *
 * The staff branch is honoured ONLY because the account holds a live link
 * in the tenant of its own staff membership. It grants no permission, no
 * membership and no role, and it mints no scoped session.
 */
export async function resolveSelfScope(
  audience: SelfServiceAudience,
  clubSlug: string | null,
): Promise<SelfScopeResolver | null> {
  const found = await readScopedSession();
  if (found) {
    if (!found.session) return null;
    if (!isLiveSession(found.session)) return null;
    if (found.session.audience !== audience) return null;
    return scopedSelfResolver(found.session, clubSlug);
  }

  const staff = await currentBetterAuthUserId();
  if (!staff) return null;
  const access = await resolveStaffTenant(staff.id, clubSlug);
  if (!access || isSessionExpiredForRole(access.roleKey, staff.createdAt)) return null;
  return staffSelfResolver(
    access.tenantId,
    access.userId,
    audience,
    clubSlug,
    { membershipId: access.membershipId, roleId: access.roleId, roleKey: access.roleKey, sessionCreatedAt: staff.createdAt },
  );
}

/**
 * The SCOPED branch only.
 *
 * The cookie-authenticated self doors (the sign-out, the set-PIN step)
 * must never accept a staff session: the scoped session is the proof
 * that the activation happened, and a staff session is a different
 * credential with a different derivation.
 */
export async function resolveScopedSelfScope(
  audience: SelfServiceAudience | null,
  clubSlug: string | null = null,
): Promise<SelfScopeResolver | null> {
  const found = await readScopedSession({ requireLive: true });
  if (!found?.session) return null;
  if (audience !== null && found.session.audience !== audience) {
    return null;
  }
  return scopedSelfResolver(found.session, clubSlug);
}

/**
 * The audience of a LIVE scoped session, or null.
 *
 * The bare-domain route calls this to decide whether a visitor holding a
 * scoped cookie lands on the member surface. It must never fall back to
 * the staff resolver: the two are different credentials.
 */
export async function resolveSelfAudience(): Promise<SelfServiceAudience | null> {
  const found = await readScopedSession({ requireLive: true });
  if (!found?.session) return null;
  return found.session.audience;
}
