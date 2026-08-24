import { headers } from "next/headers";
import { cache } from "react";
import { auth } from "./server";
import {
  resolveTenantAccessBySlug,
  resolveLocationIds,
} from "../../db/platform";

export type Ctx = {
  userId: string;
  tenantId: string;
  membershipId: string;
  role: string;
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

export async function sessionExists(): Promise<boolean> {
  const h = await headers();
  return (await auth.api.getSession({ headers: h })) !== null;
}

