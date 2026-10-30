import { and, asc, eq, exists, ilike, inArray, isNull, or, sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { members, persons } from "@/db/schema/people";
import { staff } from "@/db/schema/staff";
import type { ActionCtx } from "@/lib/auth/context";
import { normaliseToE164, phoneDigits } from "@/lib/phone";

// Staff candidate lookup — the identity picker for the existing-person branch
// of createStaff. This is a READ through the tenant scope; the create path is
// unchanged.
//
// Visibility is the human-approved restriction:
//   * live members whose HOME location is permitted, when the caller carries
//     the existing members.read grant; or
//   * live existing tenant staff, when the caller carries the existing
//     staff.read grant.
// A staff.write holder without either read grant gets no candidates. The action
// still requires staff.write itself. This preserves the source read rights: the
// lookup never invents a read grant or widens member/staff policy.
//
// Facility opt-ins are deliberately NOT an expansion here: the approved design
// uses member home locations (R1). Staff have no location column, so live staff
// are tenant-wide. Zero permitted locations therefore means authorized
// staff-only, never a silent fallback to all locations.
//
// Guardians, enquiries and other unlocated persons are not candidates unless
// they independently have a live member row at a permitted home location or a
// live staff row. Removed persons and removed member/staff rows are excluded.
//
// Dedupe is structural: the visibility test is EXISTS, not a join, so multiple
// member rows, staff rows or the same person qualifying on both paths still
// produce exactly one candidate.

export type StaffCandidate = {
  personId: string;
  fullName: string;
  phone: string | null;
};

const MAX_RESULTS = 10;

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

type PhoneMatch =
  | { mode: "digits10"; digits: string }
  | { mode: "digitsContains"; digits: string };

// Phone-shaped input only. Names (including names containing digits) keep the
// normal text search, and %/_ in a text query stay literal in the raw ILIKE.
// Matching is derived, never written back to persons.phone:
//   * a 10-digit local, 91+10, leading-0 or +91 form compares the stored
//     phone's last 10 digits (canonical, local and historical spaced rows);
//   * a shorter/other phone-like term compares the stripped stored digits
//     as a substring.
function phoneMatch(term: string): PhoneMatch | null {
  if (!/^[+(\d][\d\s\-()]*$/.test(term)) return null;
  const digits = phoneDigits(normaliseToE164(term));
  if (digits.length < 3) return null;
  if (digits.length === 12 && digits.startsWith("91")) {
    return { mode: "digits10", digits: digits.slice(2) };
  }
  if (digits.length === 10) return { mode: "digits10", digits };
  if (digits.length === 11 && digits.startsWith("0")) {
    return { mode: "digits10", digits: digits.slice(1) };
  }
  return { mode: "digitsContains", digits };
}

export async function searchStaffCandidates(
  ctx: ActionCtx,
  query: string,
): Promise<StaffCandidate[]> {
  const term = query.trim();
  if (!term) return [];

  const canReadMembers = ctx.permissions?.has("members.read") === true;
  const canReadStaff = ctx.permissions?.has("staff.read") === true;
  if (!canReadMembers && !canReadStaff) return [];

  // The approved restricted policy ignores the O-08 config default: allLocations
  // permits every live member home location; otherwise only the caller's
  // explicitly resolved location ids. A partial/internal ctx with neither field
  // fails closed to [] (staff-only when staff.read is present).
  const allLocations = ctx.allLocations === true;
  const permittedLocations = allLocations ? null : (ctx.locationIds ?? []);
  const pattern = `%${escapeLikePattern(term)}%`;
  const phoneQuery = phoneMatch(term);

  return withTenant(ctx.tenantId, async (tx) => {
    const liveStaff = canReadStaff
      ? exists(
          tx
            .select({ one: sql`1` })
            .from(staff)
            .where(
              and(
                eq(staff.tenantId, ctx.tenantId),
                eq(staff.personId, persons.id),
                isNull(staff.deletedAt),
              ),
            ),
        )
      : undefined;

    const liveMember = canReadMembers
      ? allLocations
        ? exists(
            tx
              .select({ one: sql`1` })
              .from(members)
              .where(
                and(
                  eq(members.tenantId, ctx.tenantId),
                  eq(members.personId, persons.id),
                  isNull(members.deletedAt),
                ),
              ),
          )
        : permittedLocations && permittedLocations.length > 0
          ? exists(
              tx
                .select({ one: sql`1` })
                .from(members)
                .where(
                  and(
                    eq(members.tenantId, ctx.tenantId),
                    eq(members.personId, persons.id),
                    isNull(members.deletedAt),
                    inArray(members.locationId, permittedLocations),
                  ),
                ),
            )
          : undefined
      : undefined;

    if (!liveStaff && !liveMember) return [];

    const visibility =
      liveStaff && liveMember
        ? or(liveStaff, liveMember)!
        : (liveStaff ?? liveMember)!;

    const phoneConditions = [ilike(persons.phone, pattern)];
    if (phoneQuery) {
      const storedDigits = sql`regexp_replace(${persons.phone}, '[^0-9]', '', 'g')`;
      phoneConditions.push(
        phoneQuery.mode === "digits10"
          ? sql`right(${storedDigits}, 10) = ${phoneQuery.digits}`
          : sql`${storedDigits} like ${`%${phoneQuery.digits}%`}`,
      );
    }

    const rows = await tx
      .select({
        personId: persons.id,
        fullName: persons.fullName,
        phone: persons.phone,
      })
      .from(persons)
      .where(
        and(
          eq(persons.tenantId, ctx.tenantId),
          isNull(persons.deletedAt),
          or(ilike(persons.fullName, pattern), ...phoneConditions)!,
          visibility,
        ),
      )
      .orderBy(asc(persons.fullName), asc(persons.id))
      .limit(MAX_RESULTS);

    return rows.map((row) => ({
      personId: row.personId,
      fullName: row.fullName,
      phone: row.phone,
    }));
  });
}
