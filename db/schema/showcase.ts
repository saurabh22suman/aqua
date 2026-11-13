import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import {
  bigint,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { members, persons } from "./people";
import type { MemberId, PersonId, TenantId, UserId } from "@/lib/ids";

export const SHOWCASE_DECISIONS = ["approve", "revoke", "no", "permit"] as const;
export type ShowcaseDecisionKind = (typeof SHOWCASE_DECISIONS)[number];

export const SHOWCASE_DECIDER_ROLES = ["subject", "guardian"] as const;
export type ShowcaseDeciderRole = (typeof SHOWCASE_DECIDER_ROLES)[number];

export const SHOWCASE_CHOSEN_NAME_MAX = 60;

export const showcaseProfiles = pgTable(
  "showcase_profiles",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    memberId: uuid("member_id").notNull().$type<MemberId>(),
    subjectPersonId: uuid("subject_person_id").notNull().$type<PersonId>(),
    chosenName: text("chosen_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("showcase_profiles_tenant_member_key").on(t.tenantId, t.memberId),
    unique("showcase_profiles_id_tenant_key").on(t.id, t.tenantId),
    index("showcase_profiles_tenant_member_idx").on(t.tenantId, t.memberId),
    check(
      "showcase_profiles_chosen_name_check",
      sql`char_length(${t.chosenName}) between 1 and ${SHOWCASE_CHOSEN_NAME_MAX}`,
    ),
    foreignKey({
      name: "showcase_profiles_member_tenant_fkey",
      columns: [t.memberId, t.tenantId],
      foreignColumns: [members.id, members.tenantId],
    }),
    foreignKey({
      name: "showcase_profiles_subject_tenant_fkey",
      columns: [t.subjectPersonId, t.tenantId],
      foreignColumns: [persons.id, persons.tenantId],
    }),
  ],
);

export const showcaseDecisions = pgTable(
  "showcase_decisions",
  {
    id: uuid("id").primaryKey().$defaultFn(() => uuidv7()),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" })
      .$type<TenantId>(),
    memberId: uuid("member_id").notNull().$type<MemberId>(),
    subjectPersonId: uuid("subject_person_id").notNull().$type<PersonId>(),
    deciderPersonId: uuid("decider_person_id").notNull().$type<PersonId>(),
    deciderUserId: uuid("decider_user_id").notNull().$type<UserId>(),
    memberLinkId: uuid("member_link_id"),
    guardianLinkId: uuid("guardian_link_id"),
    deciderRole: text("decider_role").notNull().$type<ShowcaseDeciderRole>(),
    decision: text("decision").notNull().$type<ShowcaseDecisionKind>(),
    decisionSeq: bigint("decision_seq", { mode: "number" }),
    createdAt: timestamp("created_at", { withTimezone: true }),
  },
  (t) => [
    index("showcase_decisions_tenant_member_seq_idx").on(
      t.tenantId,
      t.memberId,
      t.decisionSeq,
    ),
    index("showcase_decisions_tenant_member_decider_seq_idx").on(
      t.tenantId,
      t.memberId,
      t.deciderPersonId,
      t.decisionSeq,
    ),
    check(
      "showcase_decisions_decision_check",
      sql`${t.decision} in ('approve','revoke','no','permit')`,
    ),
    check(
      "showcase_decisions_decider_role_check",
      sql`${t.deciderRole} in ('subject','guardian')`,
    ),
    check(
      "showcase_decisions_subject_self_check",
      sql`${t.deciderRole} = 'guardian' or ${t.deciderPersonId} = ${t.subjectPersonId}`,
    ),
    check(
      "showcase_decisions_source_link_check",
      sql`(
        ${t.deciderRole} = 'subject'
        and ${t.memberLinkId} is not null
        and ${t.guardianLinkId} is null
      ) or (
        ${t.deciderRole} = 'guardian'
        and ${t.guardianLinkId} is not null
        and ${t.memberLinkId} is null
      )`,
    ),
    foreignKey({
      name: "showcase_decisions_member_tenant_fkey",
      columns: [t.memberId, t.tenantId],
      foreignColumns: [members.id, members.tenantId],
    }),
    foreignKey({
      name: "showcase_decisions_subject_tenant_fkey",
      columns: [t.subjectPersonId, t.tenantId],
      foreignColumns: [persons.id, persons.tenantId],
    }),
    foreignKey({
      name: "showcase_decisions_decider_tenant_fkey",
      columns: [t.deciderPersonId, t.tenantId],
      foreignColumns: [persons.id, persons.tenantId],
    }),
  ],
);

export type ShowcaseProfile = typeof showcaseProfiles.$inferSelect;
export type ShowcaseDecision = typeof showcaseDecisions.$inferSelect;
