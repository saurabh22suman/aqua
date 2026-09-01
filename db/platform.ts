import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { db } from "./client";
import { withPlatform } from "./scope";
import { withTenant, withUser } from "./tenant";
import { users } from "./schema/users";
import { tenants } from "./schema/tenants";
import { tenantMemberships } from "./schema/memberships";
import { roles } from "./schema/roles";
import { locations } from "./schema/locations";
import { membershipLocations } from "./schema/memberships";
import { baVerification } from "./schema/better-auth";
import { asUserId, type UserId, type TenantId } from "@/lib/ids";

export type TenantAccess = {
  userId: UserId;
  tenantId: TenantId;
  membershipId: string;
  roleKey: string;
  roleId: string;
  allLocations: boolean;
};

// Identity is global and RLS-exempt by design (db/CLAUDE.md) — no scope
// needed beyond withPlatform to map better-auth's id to the internal
// platform user id.
async function platformUserId(betterAuthUserId: string): Promise<UserId | null> {
  return withPlatform(async () => {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.betterAuthId, betterAuthUserId))
      .limit(1);
    return rows[0]?.id ?? null;
  });
}

export async function resolveTenantAccessBySlug(
  betterAuthUserId: string,
  slug: string,
): Promise<TenantAccess | null> {
  const userId = await platformUserId(betterAuthUserId);
  if (!userId) return null;

  return withUser(userId, async (tx) => {
    const rows = await tx
      .select({
        tenantId: tenantMemberships.tenantId,
        membershipId: tenantMemberships.id,
        roleKey: roles.key,
        roleId: roles.id,
        allLocations: tenantMemberships.allLocations,
      })
      .from(tenantMemberships)
      .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
      .innerJoin(
        roles,
        and(eq(roles.id, tenantMemberships.roleId), eq(roles.tenantId, tenantMemberships.tenantId)),
      )
      .where(
        and(
          eq(tenantMemberships.userId, userId),
          eq(tenantMemberships.status, "active"),
          isNull(tenantMemberships.deletedAt),
          eq(tenants.slug, slug),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    return { userId, ...row };
  });
}

// Dev-only OTP peek (no email/SMS channel yet — F-09 partial). Callers are
// responsible for the NODE_ENV=production gate; this just runs the query
// through the guarded pool instead of a raw connection.
export async function devVerificationCode(phone: string): Promise<string | null> {
  return withPlatform(async () => {
    const rows = await db
      .select({ value: baVerification.value })
      .from(baVerification)
      .where(and(eq(baVerification.identifier, phone), gt(baVerification.expiresAt, new Date())))
      .orderBy(desc(baVerification.createdAt))
      .limit(1);
    return rows[0]?.value.split(":")[0] ?? null;
  });
}

export async function linkBetterAuthUser(
  betterAuthUserId: string,
  phoneNumber: string,
): Promise<void> {
  await withPlatform(() =>
    db
      .insert(users)
      .values({ id: asUserId(uuidv7()), betterAuthId: betterAuthUserId, phone: phoneNumber })
      .onConflictDoUpdate({
        target: users.phone,
        set: { betterAuthId: betterAuthUserId, updatedAt: new Date() },
      }),
  );
}

// tenantId is already known by the time this is called — an ordinary
// tenant-scoped read, not pre-tenant resolution.
export async function resolveLocationIds(
  tenantId: TenantId,
  membershipId: string,
  allLocations: boolean,
): Promise<string[]> {
  return withTenant(tenantId, async (tx) => {
    if (allLocations) {
      const rows = await tx
        .select({ id: locations.id })
        .from(locations)
        .where(and(eq(locations.tenantId, tenantId), isNull(locations.deletedAt)));
      return rows.map((r) => r.id);
    }
    const rows = await tx
      .select({ id: membershipLocations.locationId })
      .from(membershipLocations)
      .where(eq(membershipLocations.membershipId, membershipId));
    return rows.map((r) => r.id);
  });
}

// Landing route and default-membership priority both come from the role
// record (roles.homePath, roles.homeOrdinal) — never from roles.key.
// F-04's Never: renaming or re-keying a role (nothing in the schema stops
// either) must not silently change or break routing.
export async function resolveHomePath(
  betterAuthUserId: string,
): Promise<string | null> {
  const userId = await platformUserId(betterAuthUserId);
  if (!userId) return null;

  return withUser(userId, async (tx) => {
    const rows = await tx
      .select({ homePath: roles.homePath })
      .from(tenantMemberships)
      .innerJoin(
        roles,
        and(eq(roles.id, tenantMemberships.roleId), eq(roles.tenantId, tenantMemberships.tenantId)),
      )
      .where(
        and(
          eq(tenantMemberships.userId, userId),
          eq(tenantMemberships.status, "active"),
          isNull(tenantMemberships.deletedAt),
        ),
      )
      .orderBy(roles.homeOrdinal)
      .limit(1);
    return rows[0]?.homePath ?? null;
  });
}

export async function resolveDefaultMembership(
  betterAuthUserId: string,
): Promise<{
  userId: UserId;
  tenantId: TenantId;
  membershipId: string;
  roleKey: string;
  roleId: string;
  allLocations: boolean;
} | null> {
  const userId = await platformUserId(betterAuthUserId);
  if (!userId) return null;

  return withUser(userId, async (tx) => {
    const rows = await tx
      .select({
        tenantId: tenantMemberships.tenantId,
        membershipId: tenantMemberships.id,
        roleKey: roles.key,
        roleId: roles.id,
        allLocations: tenantMemberships.allLocations,
      })
      .from(tenantMemberships)
      .innerJoin(
        roles,
        and(eq(roles.id, tenantMemberships.roleId), eq(roles.tenantId, tenantMemberships.tenantId)),
      )
      .where(
        and(
          eq(tenantMemberships.userId, userId),
          eq(tenantMemberships.status, "active"),
          isNull(tenantMemberships.deletedAt),
        ),
      )
      .orderBy(roles.homeOrdinal)
      .limit(1);

    const row = rows[0];
    if (!row) return null;
    return { userId, ...row };
  });
}

// The web service's health endpoint (app/api/health/route.ts) needs to
// prove DB connectivity, not just process liveness — a container that
// answers HTTP but can't reach Postgres is not healthy.
export async function pingDatabase(): Promise<void> {
  await withPlatform(() => db.execute(sql`select 1`));
}
