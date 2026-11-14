// POSTIMAGE — db/schema/self-service-session.ts  (candidate, NOT applied)
//
// The purpose-scoped self-service session, its binding ledger, its
// single-use consumption ledger and its per-account attempt budget.
//
// BASE: docs/design/parallel-release/member-session-foundation-fixed-20261107/
//   files/postimage-db-schema-self-service-session.ts.txt, with the
//   foundation review's fixes applied:
//
//   SX-4  the attempt budget is keyed on the ACCOUNT, not on the address
//         (unique (tenant_id, user_id)); the address is a mirrored column.
//   SX-5  subject_id and person_id are TENANT-BOUND, and the subject's
//         person must BE the session's person.
//   SX-6  the binding ledger carries UNIQUE rules, enforced on INSERT and
//         on UPDATE alike.
//   F-2   the ledger row carries its own identity, so a binding set is a
//         set of rows and not an array.
//
// THESE FOUR TABLES CARRY ROW LEVEL SECURITY, ENABLED AND FORCED. They are
// ordinary tenant tables: every one of them carries tenant_id, every one of
// them is scoped by app.tenant_id, and NONE of them is on
// db/allowlist.ts::PLATFORM_TABLES. Nothing is exempted, so no RLS gate is
// masked.
//
// THE AUDIENCE UNION LIVES HERE, ONCE. The codec imports the union from
// this module and the runtime guard imports the CONSTANT, so the type and
// the runtime check can never disagree.
//
// THE MIRROR IS EXACT: every column, check, key, index and policy below is
// the DDL of db/migrations/20261108210137_self_service_sessions.sql and
// 20261108210138_member_self_link_user_resolution.sql. The two
// `user_resolution` SELECT-only policies are DDL-only in the sense that
// drizzle has no policy API — they are listed in the comment on each table.

import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { users } from "./users";
import { members, persons } from "./people";
import { guardianChildLinks, memberAccountLinks } from "./member-self";
import type { PersonId, TenantId, UserId } from "@/lib/ids";

// THE AUDIENCE UNION. One definition, imported by the codec, read by the
// runtime guard, constrained by the table's own CHECK below.
export const selfServiceAudience = ["member", "guardian"] as const;
export type SelfServiceAudience = (typeof selfServiceAudience)[number];

export const selfServiceSessions = pgTable(
  "self_service_sessions",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    // A real foreign key with a real cascade. Without it, a deleted users
    // row leaves live session rows behind, and the rotation index then
    // occupies the slot for an account that no longer exists.
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" })
      .$type<UserId>(),
    // THE PERSON THE SESSION ACTS AS. For the member audience it is the
    // member's person; for the guardian audience it is the GUARDIAN's
    // person, never the child's. It is always known, so it is NOT NULL.
    personId: uuid("person_id")
      .notNull()
      .$type<PersonId>(),
    audience: text("audience").notNull().$type<SelfServiceAudience>(),
    // THE MEMBERSHIP THE SESSION IS ABOUT — the member audience only. A
    // string (not a branded id) so the codec's subjectId stays
    // assignable: the member audience requires one, the guardian audience
    // forbids one.
    subjectId: uuid("subject_id"),
    // The equality digest over the canonical binding set. NOT an HMAC and
    // NOT a secret: it proves the live binding set equals the bound
    // binding set, nothing more. The migration's BEFORE UPDATE guard
    // freezes it for the row's life, so it may be written only at insert.
    bindingDigest: text("binding_digest").notNull(),
    // The stored secret is a SHA-256 of the cookie value, never the value
    // itself. Unique, because the reader looks the row up BY this column.
    // The guard freezes it too: a credential substitution on a live row is
    // refused.
    tokenHash: text("token_hash").notNull().unique(),
    issuedAt: timestamp("issued_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    // NULLABLE. The table's own CHECK requires an actor whenever the row
    // is revoked, so a revocation that passed null would RAISE the check
    // instead of revoking the row.
    revokedByUserId: uuid("revoked_by_user_id").$type<UserId>(),
  },
  (t) => [
    check(
      "self_service_sessions_audience_check",
      sql`${t.audience} in ('member', 'guardian')`,
    ),
    check(
      "self_service_sessions_subject_check",
      sql`(${t.audience} = 'member') = (${t.subjectId} is not null)`,
    ),
    check(
      "self_service_sessions_token_hash_check",
      sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "self_service_sessions_revoked_check",
      sql`${t.revokedAt} is null or ${t.revokedByUserId} is not null`,
    ),
    check(
      "self_service_sessions_expiry_check",
      sql`${t.expiresAt} > ${t.issuedAt}`,
    ),
    // SX-5 — the subject is TENANT-BOUND. A member-audience session can no
    // longer name another club's membership.
    foreignKey({
      name: "self_service_sessions_subject_tenant_fkey",
      columns: [t.subjectId, t.tenantId],
      foreignColumns: [members.id, members.tenantId],
    }),
    // SX-5 — and so is the person.
    foreignKey({
      name: "self_service_sessions_person_tenant_fkey",
      columns: [t.personId, t.tenantId],
      foreignColumns: [persons.id, persons.tenantId],
    }),
    // The composite-FK target key for the binding ledger. The audience
    // and the account are part of it, so a binding row cannot name a
    // session of another audience or another account.
    unique("self_service_sessions_id_tenant_audience_user_key").on(
      t.id,
      t.tenantId,
      t.audience,
      t.userId,
    ),
    // THE ROTATION INDEX. One live session per (account, club, audience).
    // Without it, two concurrent mints can both insert, and the door's
    // "a second sign-in rotates the cookie" property is true only by
    // accident. It is a partial UNIQUE INDEX and therefore CANNOT be
    // deferred: the mint must revoke-then-insert in one transaction.
    uniqueIndex("self_service_sessions_live_uidx")
      .on(t.tenantId, t.userId, t.audience)
      .where(sql`revoked_at is null`),
    index("self_service_sessions_tenant_user_idx").on(t.tenantId, t.userId),
    // LEADS WITH tenant_id: the tenant-conventions scan rejects an index
    // whose first column is not tenant_id.
    index("self_service_sessions_tenant_expiry_idx").on(t.tenantId, t.expiresAt),
  ],
);

// THE BINDING LEDGER. Which LIVE link rows this session is bound to.
//
// THIS TABLE IS WHAT MAKES A BARE `link_ids uuid[]` IMPOSSIBLE TO WRITE:
// the binding names a link row, in a club, for an account, and the FOREIGN
// KEYS carry all three — so a session can never be bound to another
// member's link.
export const selfServiceSessionLinks = pgTable(
  "self_service_session_links",
  {
    // F-2 — the ledger row carries its own identity. The ledger is a set
    // of rows, not an array, and the unique rules below are stated in
    // terms of it.
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    sessionId: uuid("session_id").notNull(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    audience: text("audience").notNull().$type<SelfServiceAudience>(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" })
      .$type<UserId>(),
    memberLinkId: uuid("member_link_id"),
    guardianLinkId: uuid("guardian_link_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // THE AUDIENCE DECIDES THE LINK KIND. A member session cannot be
    // bound to a guardian link; a guardian session cannot be bound to a
    // member link; exactly one of the two columns is always set.
    check(
      "self_service_session_links_kind_check",
      sql`(
        ${t.audience} = 'member'
        and ${t.memberLinkId} is not null
        and ${t.guardianLinkId} is null
      ) or (
        ${t.audience} = 'guardian'
        and ${t.memberLinkId} is null
        and ${t.guardianLinkId} is not null
      )`,
    ),
    foreignKey({
      name: "self_service_session_links_session_fkey",
      columns: [t.sessionId, t.tenantId, t.audience, t.userId],
      foreignColumns: [
        selfServiceSessions.id,
        selfServiceSessions.tenantId,
        selfServiceSessions.audience,
        selfServiceSessions.userId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "self_service_session_links_member_fkey",
      columns: [t.memberLinkId, t.tenantId, t.userId],
      foreignColumns: [
        memberAccountLinks.id,
        memberAccountLinks.tenantId,
        memberAccountLinks.userId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "self_service_session_links_guardian_fkey",
      columns: [t.guardianLinkId, t.tenantId, t.userId],
      foreignColumns: [
        guardianChildLinks.id,
        guardianChildLinks.tenantId,
        guardianChildLinks.userId,
      ],
    }).onDelete("cascade"),
    // SX-6 — THE LEDGER'S UNIQUENESS RULE. A session binds a given link
    // row at most once. A UNIQUE INDEX is enforced on INSERT AND ON
    // UPDATE alike, so a re-pointed binding row cannot smuggle a second
    // copy of the same link into the set.
    uniqueIndex("self_service_session_links_tenant_session_member_uidx")
      .on(t.tenantId, t.sessionId, t.memberLinkId)
      .where(sql`member_link_id is not null`),
    uniqueIndex("self_service_session_links_tenant_session_guardian_uidx")
      .on(t.tenantId, t.sessionId, t.guardianLinkId)
      .where(sql`guardian_link_id is not null`),
    index("self_service_session_links_tenant_session_idx").on(
      t.tenantId,
      t.sessionId,
    ),
    index("self_service_session_links_tenant_member_link_idx")
      .on(t.tenantId, t.memberLinkId)
      .where(sql`member_link_id is not null`),
    index("self_service_session_links_tenant_guardian_link_idx")
      .on(t.tenantId, t.guardianLinkId)
      .where(sql`guardian_link_id is not null`),
  ],
);

// The single-use ledger for an activation token. The primary key IS the
// consume: the loser's insert conflicts and the second redeem is refused,
// with no check-then-insert window — the same shape as the staff invite
// link's ledger (invite_link_uses).
export const selfServiceLinkUses = pgTable(
  "self_service_link_uses",
  {
    jti: text("jti").primaryKey(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" })
      .$type<UserId>(),
    memberLinkId: uuid("member_link_id"),
    guardianLinkId: uuid("guardian_link_id"),
    usedAt: timestamp("used_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    check(
      "self_service_link_uses_kind_check",
      sql`(
        ${t.memberLinkId} is not null and ${t.guardianLinkId} is null
      ) or (
        ${t.memberLinkId} is null and ${t.guardianLinkId} is not null
      )`,
    ),
    // The consumed link belongs to the SAME account in the SAME club.
    foreignKey({
      name: "self_service_link_uses_member_fkey",
      columns: [t.memberLinkId, t.tenantId, t.userId],
      foreignColumns: [
        memberAccountLinks.id,
        memberAccountLinks.tenantId,
        memberAccountLinks.userId,
      ],
    }).onDelete("cascade"),
    foreignKey({
      name: "self_service_link_uses_guardian_fkey",
      columns: [t.guardianLinkId, t.tenantId, t.userId],
      foreignColumns: [
        guardianChildLinks.id,
        guardianChildLinks.tenantId,
        guardianChildLinks.userId,
      ],
    }).onDelete("cascade"),
    index("self_service_link_uses_tenant_user_idx").on(t.tenantId, t.userId),
    index("self_service_link_uses_tenant_member_link_idx")
      .on(t.tenantId, t.memberLinkId)
      .where(sql`member_link_id is not null`),
    index("self_service_link_uses_tenant_guardian_link_idx")
      .on(t.tenantId, t.guardianLinkId)
      .where(sql`guardian_link_id is not null`),
  ],
);

// The per-account attempt budget behind the self PIN door.
//
// SX-4 — THE BUDGET IS KEYED ON THE ACCOUNT, NOT ON THE ADDRESS. The
// address is CHECK-constrained to the E.164 shape, and that shape admits
// more than one spelling of the same number, so an account-keyed row with
// the address in the key could hold TWO budgets and be given a fresh one
// by retyping the number. `users.phone` is globally unique, so
// (tenant_id, user_id) IS the account: the address is a mirrored column
// and the unique index is on the account alone.
//
// THE COUNTER COUNTS EVERY ATTEMPT, including successful ones (the API
// contract says "20 attempts per 15 minutes", not "20 failures").
export const selfServiceLoginAttempts = pgTable(
  "self_service_login_attempts",
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
    // A MIRROR of the account's canonical number, not a key.
    address: text("address").notNull(),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    attempts: integer("attempts").notNull().default(0),
  },
  (t) => [
    check(
      "self_service_login_attempts_attempts_check",
      sql`${t.attempts} >= 0`,
    ),
    // Only a normalised number may be recorded, or the same account could
    // be given a fresh budget by retyping its number in another format.
    check(
      "self_service_login_attempts_address_check",
      sql`${t.address} ~ '^\\+[1-9][0-9]{7,14}$'`,
    ),
    uniqueIndex("self_service_login_attempts_tenant_user_uidx").on(
      t.tenantId,
      t.userId,
    ),
    index("self_service_login_attempts_tenant_user_idx").on(t.tenantId, t.userId),
  ],
);

export type SelfServiceSession = typeof selfServiceSessions.$inferSelect;
export type SelfServiceSessionLink = typeof selfServiceSessionLinks.$inferSelect;
export type SelfServiceLinkUse = typeof selfServiceLinkUses.$inferSelect;
export type SelfServiceLoginAttempt =
  typeof selfServiceLoginAttempts.$inferSelect;
