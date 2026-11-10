import { and, eq, inArray, isNull } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { locations } from "@/db/schema/locations";
import { members, persons } from "@/db/schema/people";
import { tenants } from "@/db/schema/tenants";
import type { SelfScope } from "@/lib/auth/self-scope";

// THE MEMBER AND FAMILY HOME READ MODEL.
//
// It reads ONLY the rows the resolved scope names: the scope's own member
// (the member audience) or the scope's own linked children (the guardian
// audience), and ONLY inside the tenant the scope was resolved in. There
// is no search, no list of members and no URL-supplied id — a member id
// in a query string is never read.
//
// THE READ RUNS INSIDE THE CALLER'S TRANSACTION. The caller passes the
// resolver's transaction so the recheck and this data read run in the same
// guarded tenant transaction.
//
// It reads NO phone number, NO medical note, NO invoice, NO payment and
// NO attendance. The home shows who you are, which membership you hold
// and where you train — and nothing else.
//
// THE GUARDIAN'S CHILDREN ARE NOT FILTERED BY AGE. A linked guardian
// keeps the access after the member turns 18, and only an explicit
// revocation ends it, so this read asks for the scope's live child set
// and nothing more.

export type SelfHomeEntry = {
  memberId: string;
  fullName: string;
  memberCode: string;
  status: string;
  facilityName: string | null;
};

export type SelfHomeView = {
  clubName: string;
  audience: SelfScope["audience"];
  entries: SelfHomeEntry[];
};

export async function readSelfHome(
  tx: TenantTx,
  scope: SelfScope,
  audience: SelfScope["audience"],
): Promise<SelfHomeView> {
  // THE CLUB, read inside the same scoped transaction.
  const clubRows = await tx
    .select({ name: tenants.name })
    .from(tenants)
    .where(eq(tenants.id, scope.tenantId))
    .limit(1);
  const club = clubRows[0];
  if (!club) {
    // An UNEXPECTED state, not a refusal: the club the scope was
    // resolved in is gone. It is never rendered as an empty home.
    throw new Error("self home: the club for this scope could not be read");
  }

  const memberIds =
    audience === "member"
      ? scope.memberId
        ? [scope.memberId]
        : []
      : scope.childMemberIds;

  if (memberIds.length === 0) {
    return { clubName: club.name, audience, entries: [] };
  }

  const rows = await tx
    .select({
      memberId: members.id,
      fullName: persons.fullName,
      memberCode: members.memberCode,
      status: members.status,
      facilityName: locations.name,
    })
    .from(members)
    .innerJoin(
      persons,
      and(
        eq(persons.id, members.personId),
        eq(persons.tenantId, members.tenantId),
        isNull(persons.deletedAt),
      ),
    )
    .leftJoin(
      locations,
      and(
        eq(locations.id, members.locationId),
        eq(locations.tenantId, members.tenantId),
        isNull(locations.deletedAt),
      ),
    )
    .where(
      and(
        eq(members.tenantId, scope.tenantId),
        inArray(members.id, memberIds),
        isNull(members.deletedAt),
      ),
    )
    .orderBy(persons.fullName);

  return {
    clubName: club.name,
    audience,
    entries: rows.map((row) => ({
      memberId: row.memberId,
      fullName: row.fullName,
      memberCode: row.memberCode,
      status: row.status,
      facilityName: row.facilityName,
    })),
  };
}
