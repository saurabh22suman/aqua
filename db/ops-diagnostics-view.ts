import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { withTenant } from "./tenant";
import { roles } from "./schema/roles";
import { tenantMemberships, membershipLocations } from "./schema/memberships";
import { locations } from "./schema/locations";
import { resolveTenantFeatureSources } from "./features";
import { resolvePermissionContext } from "@/lib/auth/permission";
import {
  accountEligibility,
  type DestinationEligibility,
} from "@/lib/account-eligibility";
import { isFacilityScopedRoleKey } from "@/lib/services/facility-scope";
import type { TenantSurface } from "@/lib/auth/surface-access";
import type { TenantId } from "@/lib/ids";

/** How many memberships the list shows. The total is reported beside it. */
export const MEMBERSHIP_DIAGNOSTIC_LIMIT = 50;

export type MembershipStatus = "invited" | "active" | "revoked";

export type MembershipDiagnostic = {
  /** The opaque membership id. It identifies the account ROW, not a person. */
  membershipId: string;
  roleKey: string;
  roleName: string;
  status: MembershipStatus;
  /** True when the membership reaches every facility of the club. */
  allLocations: boolean;
  facilityIds: string[];
  facilityNames: string[];
  grants: string[];
  /** The surface the role works in, and the navigation it renders. */
  surface: TenantSurface | null;
  surfaceNavigation: { href: string; label: string }[];
  destinations: DestinationEligibility[];
  /** True when the account's rows are bounded to named facilities. */
  facilityBounded: boolean;
};

export type FeatureEntitlement = {
  key: string;
  source: "plan" | "tenant_override" | "denied";
  expiresAt: Date | null;
};

export type TenantDiagnostics = {
  /** How many memberships the club has. */
  total: number;
  /** The newest memberships, bounded by MEMBERSHIP_DIAGNOSTIC_LIMIT. */
  memberships: MembershipDiagnostic[];
  /** The membership the query string asked about, when it is one of ours. */
  selected: MembershipDiagnostic | null;
  entitlements: FeatureEntitlement[];
};

type MembershipRow = {
  membershipId: string;
  roleId: string;
  roleKey: string;
  roleName: string;
  status: string;
  allLocations: boolean;
};

function membershipStatus(value: string): MembershipStatus {
  if (value === "active" || value === "revoked") return value;
  return "invited";
}

const MEMBERSHIP_COLUMNS = {
  membershipId: tenantMemberships.id,
  roleId: tenantMemberships.roleId,
  roleKey: roles.key,
  roleName: roles.name,
  status: tenantMemberships.status,
  allLocations: tenantMemberships.allLocations,
};

const MEMBERSHIP_JOIN = and(
  eq(roles.id, tenantMemberships.roleId),
  eq(roles.tenantId, tenantMemberships.tenantId),
);

/**
 * One transaction, three bounded queries: how many memberships the club
 * has, the newest page of them, and (only when the query string asked)
 * the one membership it asked about.
 */
async function readMemberships(
  tenantId: TenantId,
  membershipId: string | null,
): Promise<{
  total: number;
  list: MembershipRow[];
  selected: MembershipRow | null;
  assignments: Map<string, { id: string; name: string }[]>;
}> {
  return withTenant(tenantId, async (tx) => {
    const countRows = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(tenantMemberships)
      .where(
        and(
          eq(tenantMemberships.tenantId, tenantId),
          isNull(tenantMemberships.deletedAt),
        ),
      );
    const list = await tx
      .select(MEMBERSHIP_COLUMNS)
      .from(tenantMemberships)
      .innerJoin(roles, MEMBERSHIP_JOIN)
      .where(
        and(
          eq(tenantMemberships.tenantId, tenantId),
          isNull(tenantMemberships.deletedAt),
          isNull(roles.deletedAt),
        ),
      )
      .orderBy(desc(tenantMemberships.createdAt), desc(tenantMemberships.id))
      .limit(MEMBERSHIP_DIAGNOSTIC_LIMIT);
    const selected = membershipId
      ? await tx
          .select(MEMBERSHIP_COLUMNS)
          .from(tenantMemberships)
          .innerJoin(roles, MEMBERSHIP_JOIN)
          .where(
            and(
              eq(tenantMemberships.tenantId, tenantId),
              eq(tenantMemberships.id, membershipId),
              isNull(tenantMemberships.deletedAt),
              isNull(roles.deletedAt),
            ),
          )
          .limit(1)
      : [];
    // REVIEW D6: the memberships this response actually renders — the
    // newest page, plus the one the query string selected. The
    // assignment read below is restricted to exactly these ids.
    const membershipIds = [
      ...list.map((row) => row.membershipId),
      ...(selected[0] ? [selected[0].membershipId] : []),
    ];
    const assigned = await tx
      .select({
        membershipId: membershipLocations.membershipId,
        id: locations.id,
        name: locations.name,
      })
      .from(membershipLocations)
      .innerJoin(
        locations,
        and(
          eq(locations.id, membershipLocations.locationId),
          eq(locations.tenantId, membershipLocations.tenantId),
        ),
      )
      .where(
        and(
          eq(membershipLocations.tenantId, tenantId),
          // REVIEW D6: the assignments are read ONLY for the
          // memberships this response renders. The query used to read
          // every assignment row of the club — an unbounded read behind
          // a "bounded" claim. The bound is now the ids themselves: at
          // most MEMBERSHIP_DIAGNOSTIC_LIMIT + 1 memberships, each with
          // the facilities it is assigned to.
          inArray(membershipLocations.membershipId, membershipIds),
          isNull(locations.deletedAt),
        ),
      );
    const assignments = new Map<string, { id: string; name: string }[]>();
    for (const row of assigned) {
      const bucket = assignments.get(row.membershipId) ?? [];
      bucket.push({ id: row.id, name: row.name });
      assignments.set(row.membershipId, bucket);
    }
    return {
      total: countRows[0]?.n ?? 0,
      list,
      selected: selected[0] ?? null,
      assignments,
    };
  });
}

function describeMembership(
  row: MembershipRow,
  permissions: Set<string>,
  features: Set<string>,
  assignments: Map<string, { id: string; name: string }[]>,
): MembershipDiagnostic {
  const eligibility = accountEligibility(row.roleKey, permissions, features);
  const facilities = assignments.get(row.membershipId) ?? [];
  return {
    membershipId: row.membershipId,
    roleKey: row.roleKey,
    roleName: row.roleName,
    status: membershipStatus(row.status),
    allLocations: row.allLocations,
    facilityIds: facilities.map((f) => f.id),
    facilityNames: facilities.map((f) => f.name),
    grants: [...permissions].sort(),
    surface: eligibility.surface,
    surfaceNavigation: eligibility.surfaceNavigation,
    destinations: eligibility.destinations,
    facilityBounded: isFacilityScopedRoleKey(row.roleKey) && !row.allLocations,
  };
}

/**
 * The whole read, in ONE call, so ONE audited operation row covers it.
 *
 * `membershipId` selects which of this club's memberships to describe in
 * full. It is never anything else: it cannot change a role, a facility
 * scope or a grant.
 */
export async function getTenantDiagnostics(
  tenantId: TenantId,
  options: { membershipId?: string | null } = {},
): Promise<TenantDiagnostics> {
  const membershipId = options.membershipId ?? null;
  const { total, list, selected, assignments } = await readMemberships(
    tenantId,
    membershipId,
  );

  // The canonical resolution for each role in this club — the same call
  // the tenant's own request path makes. One call per DISTINCT role, so
  // the cost is bounded by the club's roles, not by its membership count.
  const contexts = new Map<string, {
    permissions: Set<string>;
    features: Set<string>;
  }>();
  for (const row of [...list, ...(selected ? [selected] : [])]) {
    if (contexts.has(row.roleId)) continue;
    const resolved = await resolvePermissionContext(tenantId, row.roleId);
    contexts.set(row.roleId, {
      permissions: resolved.permissions,
      features: resolved.features,
    });
  }

  const memberships = list.map((row) => {
    const context = contexts.get(row.roleId)!;
    return describeMembership(row, context.permissions, context.features, assignments);
  });

  let selectedDiagnostic: MembershipDiagnostic | null = null;
  if (selected) {
    const context = contexts.get(selected.roleId)!;
    selectedDiagnostic = describeMembership(
      selected,
      context.permissions,
      context.features,
      assignments,
    );
  }

  const entitlements: FeatureEntitlement[] = (
    await resolveTenantFeatureSources(tenantId)
  ).map((feature) => ({
    key: feature.key,
    source: feature.source,
    expiresAt: feature.expiresAt ?? null,
  }));

  return { total, memberships, selected: selectedDiagnostic, entitlements };
}
