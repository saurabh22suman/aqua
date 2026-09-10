import { headers } from "next/headers";
import { cache } from "react";
import { auth } from "./server";
import { isSessionExpiredForRole } from "./permissions";
import { resolvePermissionContext } from "./permission";
import type { UserId, TenantId } from "@/lib/ids";
import {
  resolveTenantAccessBySlug,
  resolveDefaultMembership,
  resolveLocationIds,
} from "../../db/platform";

export type Ctx = {
  userId: UserId;
  tenantId: TenantId;
  membershipId: string;
  roleKey: string;
  roleId: string;
  slug: string;
  allLocations: boolean;
  locationIds: string[];
  // Role grants and tenant feature entitlements, both populated
  // once per request. requirePermission(ctx, "x.y") is the single
  // resolution; hasPermission / hasFeature are the cheap reads used
  // by UI gating. See lib/auth/permission.ts.
  permissions: Set<string>;
  features: Set<string>;
};

// M3: every lib/services/*.ts file independently redeclared this as
// `Pick<Ctx, "tenantId"> & { userId?: string }` -- the `userId` half
// hand-typed as a plain string rather than derived from Ctx, in all
// eight files, identically. That's exactly why branding UserId didn't
// close the gap it was meant to: every service function's userId
// parameter accepted any string, unbranded, no matter how carefully
// the schema columns were typed. One shared type instead of eight
// independently-drifting copies.
export type ActionCtx = Pick<Ctx, "tenantId"> & Partial<Pick<Ctx, "userId">>;

export class NotFoundError extends Error {
  constructor() {
    super("not found");
  }
}

export async function resolveCtxFor(
  betterAuthUserId: string,
  slug: string,
): Promise<Ctx> {
  const access = await resolveTenantAccessBySlug(betterAuthUserId, slug);
  if (!access) throw new NotFoundError();

  const { permissions, features } = await resolvePermissionContext(
    access.tenantId,
    access.roleId,
  );
  const locationIds = await resolveLocationIds(access.tenantId, access.membershipId, access.allLocations);

  return { ...access, slug, locationIds, permissions, features };
}

export const requireCtx = cache(async (slug: string): Promise<Ctx> => {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  if (!session?.user) throw new NotFoundError();

  const ctx = await resolveCtxFor(session.user.id, slug);
  if (
    isSessionExpiredForRole(
      ctx.roleKey,
      new Date(session.session.createdAt).getTime(),
    )
  ) {
    throw new NotFoundError();
  }
  return ctx;
});

export async function requireDefaultCtx(): Promise<Ctx> {
  const h = await headers();
  const session = await withPlatformSafe(() => auth.api.getSession({ headers: h }));
  if (!session?.user) throw new NotFoundError();

  const membership = await resolveDefaultMembership(session.user.id);
  if (!membership) throw new NotFoundError();

  if (
    isSessionExpiredForRole(
      membership.roleKey,
      new Date(session.session.createdAt).getTime(),
    )
  ) {
    throw new NotFoundError();
  }

  const { permissions, features } = await resolvePermissionContext(
    membership.tenantId,
    membership.roleId,
  );
  const locationIds = await resolveLocationIds(
    membership.tenantId,
    membership.membershipId,
    membership.allLocations,
  );

  return {
    // membership.userId is the resolved platform users.id -- NOT
    // session.user.id, which is better-auth's own id, a different id
    // space (found while adding coach-assignment scoping: comparing
    // session.user.id against a stored users.id never matched for a
    // real logged-in user, only in tests that fabricated a matching
    // value directly). resolveCtxFor (the other Ctx-building path,
    // used by requireCtx) already got this right via
    // resolveTenantAccessBySlug's TenantAccess.userId; this brings
    // requireDefaultCtx into agreement with it instead of leaving two
    // paths that silently disagree on what ctx.userId means.
    userId: membership.userId,
    tenantId: membership.tenantId,
    membershipId: membership.membershipId,
    roleKey: membership.roleKey,
    roleId: membership.roleId,
    slug: "",
    allLocations: membership.allLocations,
    locationIds,
    permissions,
    features,
  };
}

async function withPlatformSafe<T>(fn: () => Promise<T>): Promise<T> {
  const { withPlatform } = await import("@/db/scope");
  return withPlatform(fn);
}

export async function sessionExists(): Promise<boolean> {
  const h = await headers();
  const session = await withPlatformSafe(() => auth.api.getSession({ headers: h }));
  if (!session?.user) return false;

  // Freshness-aware: every role layout redirects to /login on false,
  // so an expired receptionist session must read as absent HERE --
  // otherwise the layout renders, the page's requireDefaultCtx throws,
  // and the user is trapped on an error page with no path back to
  // login. Membership resolution costs one indexed read per layout
  // render; correctness of the redirect is worth it.
  const membership = await resolveDefaultMembership(session.user.id);
  if (!membership) return false;
  if (
    isSessionExpiredForRole(
      membership.roleKey,
      new Date(session.session.createdAt).getTime(),
    )
  ) {
    return false;
  }
  return session !== null;
}

