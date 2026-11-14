// POSTIMAGE — db/schema/member-self.ts  (candidate, NOT applied)
//
// The two LINK tables. One account's link to one membership
// (member_account_links) and to one CHILD through the club's guardianship
// row (guardian_child_links).
//
// BASE: docs/design/parallel-release/member-session-foundation-fixed-20261107/
//   files/postimage-db-schema-member-self.ts.txt (the reserved lane's own
//   artefact plus the foundation's six amendments), reproduced here with the
//   amendment names kept.
//
// THE PHYSICAL NAME verified_phone IS INHERITED AND MISLEADING. It is a
// snapshot of the number on the club's member record at provisioning. It is
// NOT an SMS check, NOT an OTP and NOT proof that the person owns the
// phone. verificationMethod is 'club_record' only. No surface may call this
// number verified.
//
// THE account_binding_* COLUMNS ARE A STAFF ATTESTATION, NOT A PHONE
// VERIFICATION. They record that this ACCOUNT is this MEMBER's account.
// They carry no number, they never set phone_number_verified, and there is
// no OTP and no SMS anywhere in this feature.
//
// THE SCHEMA RECORDS WHO AND WHERE; IT DOES NOT AUTHORISE. Whether the
// confirmer holds members.link.confirm, and whether a manager is assigned to
// the named facility, are the action layer's checks
// (lib/services/member-link-binding.ts).

import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { auditColumns } from "./_shared";
import { tenants } from "./tenants";
import { users } from "./users";
import { members } from "./people";
import { guardianships } from "./consent";
import { locations } from "./locations";
import type { MemberId, TenantId, UserId } from "@/lib/ids";

const E164_SHAPE = sql`'^\\+[1-9][0-9]{7,14}$'`;

export const memberAccountLinks = pgTable(
  "member_account_links",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" })
      .$type<UserId>(),
    // Branded, because the composite foreign key below points at
    // members(id, tenant_id) and members.id is $type<MemberId>().
    memberId: uuid("member_id").notNull().$type<MemberId>(),
    status: text("status").notNull().default("active"),
    verificationMethod: text("verification_method").notNull(),
    recordedAt: timestamp("verified_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    recordedByUserId: uuid("verified_by_user_id").notNull().$type<UserId>(),
    recordedPhone: text("verified_phone"),
    recordedPhoneAt: timestamp("verified_phone_verified_at", {
      withTimezone: true,
    }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByUserId: uuid("revoked_by_user_id").$type<UserId>(),
    // The staff attestation that this account is this member's account. NO
    // FOREIGN KEY on the confirmer's id, on purpose: a foreign key with
    // `on delete set null` would make the quartet-together CHECK below
    // unsatisfiable by the FK's own action, and a platform user delete
    // would then fail with a constraint violation. The confirmer's id is
    // EVIDENCE, not a live reference. The audit row is the record.
    accountBindingConfirmedByUserId: uuid(
      "account_binding_confirmed_by_user_id",
    ).$type<UserId>(),
    accountBindingConfirmedAt: timestamp("account_binding_confirmed_at", {
      withTimezone: true,
    }),
    accountBindingBasis: text("account_binding_basis"),
    // WHICH facility a facility-limited manager's attestation was scoped
    // to. NULL for an owner's attestation.
    accountBindingFacilityId: uuid("account_binding_facility_id"),
    ...auditColumns,
  },
  (t) => [
    check(
      "member_account_links_status_check",
      // 'invited' is the state a provisioned-but-not-yet-accepted link
      // carries. The activation flips it to 'active'.
      sql`${t.status} in ('active', 'invited', 'revoked')`,
    ),
    check(
      "member_account_links_verification_check",
      sql`${t.verificationMethod} = 'club_record'`,
    ),
    check(
      "member_account_links_revocation_check",
      sql`(${t.status} = 'revoked') = (${t.revokedAt} is not null)`,
    ),
    check(
      "member_account_links_revoker_check",
      sql`(${t.status} = 'revoked') = (${t.revokedByUserId} is not null)`,
    ),
    check(
      "member_account_links_verified_phone_check",
      sql`${t.recordedPhone} is null or ${t.recordedPhone} ~ ${E164_SHAPE}`,
    ),
    check(
      "member_account_links_verified_phone_pair_check",
      sql`(${t.recordedPhone} is null) = (${t.recordedPhoneAt} is null)`,
    ),
    // The quartet travels together or not at all, so a half-written
    // attestation is not representable. The basis says which authorised
    // actor stood behind it, and the CHECK makes the two branches mutually
    // exclusive: the owner's carries no facility, the manager's must.
    check(
      "member_account_links_account_binding_check",
      sql`(
        ${t.accountBindingConfirmedByUserId} is null
        and ${t.accountBindingConfirmedAt} is null
        and ${t.accountBindingBasis} is null
        and ${t.accountBindingFacilityId} is null
      ) or (
        ${t.accountBindingConfirmedByUserId} is not null
        and ${t.accountBindingConfirmedAt} is not null
        and (
          (${t.accountBindingBasis} = 'owner_attestation'
           and ${t.accountBindingFacilityId} is null)
          or
          (${t.accountBindingBasis} = 'facility_manager_attestation'
           and ${t.accountBindingFacilityId} is not null)
        )
      )`,
    ),
    // The predicate is `status in ('active', 'invited')`, NOT
    // `status = 'active'`. With 'active' alone, a member could hold an
    // 'invited' link AND an 'active' link at the same time, and the
    // activation's 'invited' -> 'active' flip would then raise a unique
    // violation — a DATABASE ERROR on a routine path, instead of a
    // refusal. The INDEX NAMES are the reserved lane's, unchanged.
    uniqueIndex("member_account_links_active_member_uidx")
      .on(t.tenantId, t.memberId)
      .where(sql`status in ('active', 'invited')`),
    uniqueIndex("member_account_links_active_user_uidx")
      .on(t.tenantId, t.userId)
      .where(sql`status in ('active', 'invited')`),
    index("member_account_links_tenant_user_idx").on(
      t.tenantId,
      t.userId,
      t.status,
    ),
    index("member_account_links_tenant_verified_phone_idx")
      .on(t.tenantId, t.recordedPhone)
      .where(sql`status in ('active', 'invited')`),
    // The composite-FK target key the session binding ledger needs:
    // (id, tenant_id, user_id), so a session can only be bound to a link
    // that belongs to the same account in the same club.
    unique("member_account_links_id_tenant_user_key").on(
      t.id,
      t.tenantId,
      t.userId,
    ),
    foreignKey({
      name: "member_account_links_member_tenant_fkey",
      columns: [t.memberId, t.tenantId],
      foreignColumns: [members.id, members.tenantId],
    }).onDelete("cascade"),
    // A manager's attestation is scoped to a facility of THIS club. MATCH
    // SIMPLE: a NULL facility_id satisfies the constraint, which is what
    // the owner's branch needs.
    foreignKey({
      name: "member_account_links_account_binding_facility_fkey",
      columns: [t.accountBindingFacilityId, t.tenantId],
      foreignColumns: [locations.id, locations.tenantId],
    }),
  ],
);

export const guardianChildLinks = pgTable(
  "guardian_child_links",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" })
      .$type<UserId>(),
    guardianshipId: uuid("guardianship_id").notNull(),
    memberId: uuid("member_id").$type<MemberId>(),
    status: text("status").notNull().default("active"),
    verificationMethod: text("verification_method").notNull(),
    recordedAt: timestamp("verified_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    recordedByUserId: uuid("verified_by_user_id").notNull().$type<UserId>(),
    recordedPhone: text("verified_phone"),
    recordedPhoneAt: timestamp("verified_phone_verified_at", {
      withTimezone: true,
    }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedByUserId: uuid("revoked_by_user_id").$type<UserId>(),
    // The same quartet, with the same meaning and the same no-foreign-key
    // rule. A guardian's pairing is attested the same way a member's is.
    accountBindingConfirmedByUserId: uuid(
      "account_binding_confirmed_by_user_id",
    ).$type<UserId>(),
    accountBindingConfirmedAt: timestamp("account_binding_confirmed_at", {
      withTimezone: true,
    }),
    accountBindingBasis: text("account_binding_basis"),
    accountBindingFacilityId: uuid("account_binding_facility_id"),
    ...auditColumns,
  },
  (t) => [
    check(
      "guardian_child_links_status_check",
      // The same 'invited' state as the member table.
      sql`${t.status} in ('active', 'invited', 'revoked')`,
    ),
    check(
      "guardian_child_links_verification_check",
      sql`${t.verificationMethod} = 'club_record'`,
    ),
    check(
      "guardian_child_links_revocation_check",
      sql`(${t.status} = 'revoked') = (${t.revokedAt} is not null)`,
    ),
    check(
      "guardian_child_links_revoker_check",
      sql`(${t.status} = 'revoked') = (${t.revokedByUserId} is not null)`,
    ),
    check(
      "guardian_child_links_verified_phone_check",
      sql`${t.recordedPhone} is null or ${t.recordedPhone} ~ ${E164_SHAPE}`,
    ),
    check(
      "guardian_child_links_verified_phone_pair_check",
      sql`(${t.recordedPhone} is null) = (${t.recordedPhoneAt} is null)`,
    ),
    check(
      "guardian_child_links_account_binding_check",
      sql`(
        ${t.accountBindingConfirmedByUserId} is null
        and ${t.accountBindingConfirmedAt} is null
        and ${t.accountBindingBasis} is null
        and ${t.accountBindingFacilityId} is null
      ) or (
        ${t.accountBindingConfirmedByUserId} is not null
        and ${t.accountBindingConfirmedAt} is not null
        and (
          (${t.accountBindingBasis} = 'owner_attestation'
           and ${t.accountBindingFacilityId} is null)
          or
          (${t.accountBindingBasis} = 'facility_manager_attestation'
           and ${t.accountBindingFacilityId} is not null)
        )
      )`,
    ),
    // The same predicate narrowing as the member table.
    uniqueIndex("guardian_child_links_active_guardianship_uidx")
      .on(t.tenantId, t.guardianshipId)
      .where(sql`status in ('active', 'invited')`),
    uniqueIndex("guardian_child_links_active_user_uidx")
      .on(t.tenantId, t.userId, t.guardianshipId)
      .where(sql`status in ('active', 'invited')`),
    index("guardian_child_links_tenant_user_idx").on(
      t.tenantId,
      t.userId,
      t.status,
    ),
    index("guardian_child_links_tenant_verified_phone_idx")
      .on(t.tenantId, t.recordedPhone)
      .where(sql`status in ('active', 'invited')`),
    index("guardian_child_links_tenant_member_idx")
      .on(t.tenantId, t.memberId)
      .where(sql`member_id is not null`),
    // The same composite-FK target key as the member table.
    unique("guardian_child_links_id_tenant_user_key").on(
      t.id,
      t.tenantId,
      t.userId,
    ),
    foreignKey({
      name: "guardian_child_links_guardianship_tenant_fkey",
      columns: [t.guardianshipId, t.tenantId],
      foreignColumns: [guardianships.id, guardianships.tenantId],
    }).onDelete("cascade"),
    foreignKey({
      name: "guardian_child_links_member_tenant_fkey",
      columns: [t.memberId, t.tenantId],
      foreignColumns: [members.id, members.tenantId],
    }).onDelete("cascade"),
    foreignKey({
      name: "guardian_child_links_account_binding_facility_fkey",
      columns: [t.accountBindingFacilityId, t.tenantId],
      foreignColumns: [locations.id, locations.tenantId],
    }),
  ],
);

export type MemberAccountLink = typeof memberAccountLinks.$inferSelect;
export type GuardianChildLink = typeof guardianChildLinks.$inferSelect;
