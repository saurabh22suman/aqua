import { readFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { fixture } from "../../remediation-20261112/fixture";
import { withTenant } from "@/db/tenant";

let f: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => {
  f = await fixture();
  await f.admin.query(`insert into audit_log (tenant_id, actor_type, action, entity_type, "after")
    select $1, 'system', case when n % 3 = 0 then 'attendance.mark' else 'other.action' end,
      case when n % 3 = 0 then 'attendance' else 'other' end,
      jsonb_build_object('clientId', 'synthetic-' || n) from generate_series(1, 18000) n`, [f.tenantId]);
  await f.admin.query("analyze audit_log");
});
afterAll(async () => {
  if (!f) return;
  await f.admin.query("delete from whatsapp_notification_outbox where tenant_id=$1", [f.tenantId]);
  await f.cleanup();
});

it("uses the partial index for the runtime predicate with a generic plan under tenant RLS", async () => {
  const source = readFileSync("lib/services/attendance-mark.ts", "utf8");
  const literal = source.includes("sql`${auditLog.action} = 'attendance.mark'`") && source.includes("sql`${auditLog.entityType} = 'attendance'`");
  const indexes = await f.admin.query<{ name: string }>(`select child.relname as name from pg_inherits
    join pg_class parent on parent.oid=inhparent join pg_class child on child.oid=inhrelid
    where parent.relname='audit_log_attendance_operation_idx'`);
  expect(indexes.rows.length).toBeGreaterThan(0);
  const result = await withTenant(f.tenantId, async tx => {
    const identity = await tx.execute(sql`select session_user as login, current_user as role`);
    expect(identity.rows[0]).toMatchObject({ login: "app_login" });
    await tx.execute(sql`set local plan_cache_mode = force_generic_plan`);
    await tx.execute(sql.raw(literal
      ? `prepare attendance_idx_plan(uuid, text, text, text) as select "after" from audit_log where tenant_id = $1 and action = 'attendance.mark' and entity_type = 'attendance' and "after"->>'clientId' = $2`
      : `prepare attendance_idx_plan(uuid, text, text, text) as select "after" from audit_log where tenant_id = $1 and action = $3 and entity_type = $4 and "after"->>'clientId' = $2`));
    try {
      return await tx.execute(sql.raw(`explain (format json) execute attendance_idx_plan('${f.tenantId}'::uuid, 'synthetic-3', 'attendance.mark', 'attendance')`));
    } finally { await tx.execute(sql`deallocate attendance_idx_plan`); }
  });
  expect(literal).toBe(true);
  const plan = JSON.stringify(result);
  const used = indexes.rows.map(row => row.name).find(name => plan.includes(`"Index Name":"${name}"`));
  console.log("GENERIC_PLAN_INDEX", used);
  expect(used).toBeDefined();
  const foreign = await withTenant(f.otherTenant, tx => tx.execute(sql`select "after" from audit_log
    where tenant_id = ${f.tenantId} and action = 'attendance.mark' and entity_type = 'attendance'
      and "after"->>'clientId' = ${"synthetic-3"}`));
  expect(foreign.rows).toHaveLength(0);
});

it("accepts all supported outbox roles and rejects unsupported roles", async () => {
  for (const role of ["owner", "coach", "curriculum_lead", "receptionist", "worker", "manager", "accountant"]) {
    await f.admin.query("insert into whatsapp_notification_outbox(id,tenant_id,event_key,recipient_user_id,phone,body,recipient_role) values(gen_random_uuid(),$1,$2,$3,$4,'synthetic',$5)", [f.tenantId, `role-${role}`, f.userId, `+91900000000${role.length}`, role]);
  }
  await expect(f.admin.query("insert into whatsapp_notification_outbox(id,tenant_id,event_key,recipient_user_id,phone,body,recipient_role) values(gen_random_uuid(),$1,'bad',$2,'+919000000000','synthetic','unsupported')", [f.tenantId, f.userId])).rejects.toMatchObject({ code: "23514" });
});
