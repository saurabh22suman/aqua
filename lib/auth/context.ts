import { headers } from "next/headers";
import { cache } from "react";
import { auth } from "./server";
import {
  resolveTenantAccessBySlug,
  resolveDefaultMembership,
  resolveLocationIds,
} from "../../db/platform";

export type Ctx = {
  userId: string;
  tenantId: string;
  membershipId: string;
  roleKey: string;
  roleId: string;
  slug: string;
  allLocations: boolean;
  locationIds: string[];
};

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

  const locationIds = await resolveLocationIds(access.tenantId, access.membershipId, access.allLocations);

  return { ...access, slug, locationIds };
}

export const requireCtx = cache(async (slug: string): Promise<Ctx> => {
  const h = await headers();
  const session = await auth.api.getSession({ headers: h });
  if (!session?.user) throw new NotFoundError();

  return resolveCtxFor(session.user.id, slug);
});

export async function requireDefaultCtx(): Promise<Ctx> {
  const h = await headers();
  const session = await withPlatformSafe(() => auth.api.getSession({ headers: h }));
  if (!session?.user) throw new NotFoundError();

  const membership = await resolveDefaultMembership(session.user.id);
  if (!membership) throw new NotFoundError();

  const locationIds = await resolveLocationIds(
    membership.tenantId,
    membership.membershipId,
    membership.allLocations,
  );

  return {
    userId: session.user.id,
    tenantId: membership.tenantId,
    membershipId: membership.membershipId,
    roleKey: membership.roleKey,
    roleId: membership.roleId,
    slug: "",
    allLocations: membership.allLocations,
    locationIds,
  };
}

async function withPlatformSafe<T>(fn: () => Promise<T>): Promise<T> {
  const { withPlatform } = await import("@/db/scope");
  return withPlatform(fn);
}

export async function sessionExists(): Promise<boolean> {
  const h = await headers();
  const session = await withPlatformSafe(() => auth.api.getSession({ headers: h }));
  return session !== null;
}

