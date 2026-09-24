import { and, eq, isNull } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { members, persons } from "@/db/schema/people";
import type { ActionCtx } from "@/lib/auth/context";
import type { ParsedMemberImportRow } from "@/lib/services/member-import-csv";
import { locationPredicate, resolveLocationAccess } from "@/lib/services/location-access";

// The operator's member code wins; otherwise use phone/name/DOB for
// adults and name/DOB for minors without their own phone. Never update
// a matched record on import.
export async function findExistingImportMemberId(
  tx: TenantTx,
  ctx: ActionCtx,
  row: ParsedMemberImportRow,
): Promise<string | null> {
  const access = await resolveLocationAccess(tx, ctx);
  const visible = locationPredicate(members.locationId, access);
  if (row.memberCode) {
    const byCode = await tx.select({ id: members.id }).from(members)
      .where(and(eq(members.tenantId, ctx.tenantId), eq(members.memberCode, row.memberCode), isNull(members.deletedAt), visible))
      .limit(1);
    if (byCode[0]) return byCode[0].id;
  }

  const personConditions = [
    eq(members.tenantId, ctx.tenantId),
    isNull(members.deletedAt),
    visible,
    eq(persons.fullName, row.fullName),
    eq(persons.dateOfBirth, row.dateOfBirth),
  ];
  if (row.phone) personConditions.push(eq(persons.phone, row.phone));
  const [existing] = await tx.select({ id: members.id }).from(members)
    .innerJoin(persons, and(eq(persons.id, members.personId), eq(persons.tenantId, members.tenantId)))
    .where(and(...personConditions)).limit(1);
  return existing?.id ?? null;
}
