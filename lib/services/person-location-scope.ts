import { and, eq, exists, inArray, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { TenantTx } from '@/db/tenant';
import { members, persons } from '@/db/schema/people';
import { guardianships } from '@/db/schema/consent';
import { staff } from '@/db/schema/staff';
import { staffLocations } from '@/db/schema/staff-locations';
import type { TenantId } from '@/lib/ids';
import type { LocationAccess } from './location-access';

const child = alias(persons, 'guardian_scope_child');

/** Correlates with the outer persons row; apply before ordering/limiting.
 * The legacy includeUnlocated branch keeps its existing person lookup.
 * Strict facility roles and denied callers never inherit that broad answer.
 */
export function personLocationPredicate(tx:TenantTx, tenantId:TenantId, access:LocationAccess):SQL|undefined {
  if(access.unrestricted) return undefined;
  if(access.denied) return sql`false`;
  if(access.includeUnlocated) return undefined;
  if(access.locationIds.length===0) return sql`false`;
  const member = exists(tx.select({one:sql`1`}).from(members).where(and(
    eq(members.tenantId,tenantId),eq(members.personId,persons.id),isNull(members.deletedAt),inArray(members.locationId,access.locationIds),
  )));
  const guardian = exists(tx.select({one:sql`1`}).from(guardianships)
    .innerJoin(members,and(eq(members.tenantId,guardianships.tenantId),eq(members.personId,guardianships.minorId)))
    .innerJoin(child,and(eq(child.tenantId,members.tenantId),eq(child.id,members.personId)))
    .where(and(eq(guardianships.tenantId,tenantId),eq(guardianships.guardianId,persons.id),isNull(guardianships.deletedAt),isNull(members.deletedAt),isNull(child.deletedAt),inArray(members.locationId,access.locationIds))));
  const employee = exists(tx.select({one:sql`1`}).from(staff)
    .innerJoin(staffLocations,and(eq(staffLocations.tenantId,staff.tenantId),eq(staffLocations.staffId,staff.id)))
    .where(and(eq(staff.tenantId,tenantId),eq(staff.personId,persons.id),isNull(staff.deletedAt),inArray(staffLocations.locationId,access.locationIds))));
  return or(member,guardian,employee);
}
