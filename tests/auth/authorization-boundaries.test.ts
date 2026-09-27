import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { asTenantId, asUserId } from "@/lib/ids";
import { seedRoleTemplates } from "@/lib/services/roles";
import { deleteAuditRowsForTenant } from "@/tests/helpers/audit-log-cleanup";
import { enrolMemberAction } from "@/lib/actions/enrolment";
import { markAttendanceSessionAction } from "@/lib/actions/coach";
import { issueParentLinkAction } from "@/lib/actions/parent-link";
import { listPaymentReversalsAction } from "@/lib/actions/payment-reversals";
import { enrolMember } from "@/lib/services/register";
import { setCredential } from "@/lib/services/credentials";
import { POST as loginWithPin } from "@/app/api/login/pin/route";

// The PIN route issues a real Better Auth session. Only Next's request
// headers() transport is supplied, with the actual cookie from that login.
const { session } = vi.hoisted(() => ({ session: { cookie: "" } }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ cookie: session.cookie }),
}));

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const tenantId = asTenantId(uuidv7());
const otherTenantId = asTenantId(uuidv7());
const a = uuidv7();
const b = uuidv7();
const programId = uuidv7();
const batchA = uuidv7();
const batchB = uuidv7();
const sessionB = uuidv7();
const memberA = uuidv7();
const memberB = uuidv7();
const outsiderA = uuidv7();
const otherMember = uuidv7();
const paymentB = uuidv7();
const paymentA = uuidv7();
const userOwner = asUserId(uuidv7());
const userAdmin = asUserId(uuidv7());
const userScopedOwner = asUserId(uuidv7());
const userReception = asUserId(uuidv7());
const userAccountant = asUserId(uuidv7());
const RUN = Date.now().toString(36);
const phones = new Map<string, string>();
const cookies = new Map<string, string>();

async function signIn(role: "owner" | "admin" | "scopedOwner" | "reception" | "accountant") {
  const saved = cookies.get(role);
  if (saved) { session.cookie = saved; return; }
  const response = await loginWithPin(new Request("http://localhost/api/login/pin", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone: phones.get(role), pin: "123456" }),
  }));
  if (response.status !== 200) throw new Error(`PIN login failed for ${role}: ${response.status}`);
  const cookie = response.headers.getSetCookie()
    .find((value) => value.startsWith("better-auth.session_token="))?.split(";")[0];
  if (!cookie) throw new Error(`No Better Auth session for ${role}`);
  cookies.set(role, cookie);
  session.cookie = cookie;
}

beforeAll(async () => {
  const [plan] = (await admin.query<{ id: string }>("select id from plans where is_default=true limit 1")).rows;
  await admin.query(`insert into tenants (id,slug,name,status,plan_id) values
    ($1,$3,'Boundary A','active',$5),($2,$4,'Boundary B','active',$5)`,
    [tenantId, otherTenantId, `boundary-a-${RUN}`, `boundary-b-${RUN}`, plan!.id]);
  await seedRoleTemplates(tenantId);
  await admin.query(`insert into locations(id,tenant_id,name,is_primary) values
    ($1,$3,'Site A',true),($2,$3,'Site B',false)`, [a, b, tenantId]);
  await admin.query(`insert into config_values(id,key,scope_type,scope_id,tenant_id,value)
    values ($1,'access.location_scoped_staff','tenant',$2::text,$2::uuid,'true'::jsonb)`, [uuidv7(), tenantId]);

  const roles = await admin.query<{ id: string; key: string }>(
    "select id,key from roles where tenant_id=$1 and key in ('owner','admin','receptionist','accountant')", [tenantId]);
  const roleId = (key: string) => roles.rows.find((row) => row.key === key)!.id;
  for (const [id, role, allLocations] of [
    [userOwner, "owner", true],
    [userAdmin, "admin", true],
    [userScopedOwner, "owner", false],
    [userReception, "reception", false],
    [userAccountant, "accountant", false],
  ] as const) {
    const key = role === "reception" ? "reception" : role === "accountant" ? "accountant" : role === "admin" ? "admin" : allLocations ? "owner" : "scopedOwner";
    const betterAuthId = `boundary-${key}-${RUN}`;
    const phone = `+919${String(id).replace(/\D/g, "").slice(-9)}`;
    phones.set(key, phone);
    await admin.query("insert into ba_user(id,name,email,phone_number,phone_number_verified) values ($1,$2,$3,$4,true)",
      [betterAuthId, key, `${key.toLowerCase()}-${RUN}@boundary.invalid`, phone]);
    await admin.query("insert into users(id,phone,better_auth_id) values ($1,$2,$3)",
      [id, phone, betterAuthId]);
    await setCredential(betterAuthId, "123456");
    const membershipId = uuidv7();
    await admin.query(`insert into tenant_memberships(id,tenant_id,user_id,role_id,all_locations,status)
      values ($1,$2,$3,$4,$5,'active')`, [membershipId, tenantId, id, roleId(role === "reception" ? "receptionist" : role), allLocations]);
    if (!allLocations) await admin.query(`insert into membership_locations(id,tenant_id,membership_id,location_id)
      values ($1,$2,$3,$4)`, [uuidv7(), tenantId, membershipId, a]);
  }

  await admin.query("insert into programs(id,tenant_id,name) values ($1,$2,'Program')", [programId, tenantId]);
  await admin.query(`insert into batches(id,tenant_id,program_id,location_id,name,capacity,days_of_week,start_time,end_time)
    values ($1,$3,$4,$5,'A batch',10,'{1}','07:00','08:00'),
      ($2,$3,$4,$6,'B batch',10,'{1}','09:00','10:00')`, [batchA, batchB, tenantId, programId, a, b]);
  const personA = uuidv7();
  const personB = uuidv7();
  const outsiderPerson = uuidv7();
  const otherPerson = uuidv7();
  await admin.query(`insert into persons(id,tenant_id,full_name,date_of_birth) values
    ($1,$5,'Member A','1990-01-01'),($2,$5,'Member B','1990-01-01'),
    ($3,$5,'Outsider','1990-01-01'),($4,$6,'Other tenant','1990-01-01')`,
    [personA, personB, outsiderPerson, otherPerson, tenantId, otherTenantId]);
  await admin.query(`insert into members(id,tenant_id,person_id,location_id,member_code) values
    ($1,$4,$5,$8,$10),($2,$4,$6,$9,$11),($3,$4,$7,$8,$12)`,
    [memberA, memberB, outsiderA, tenantId, personA, personB, outsiderPerson, a, b,
      `BA-${RUN}`, `BB-${RUN}`, `OUT-${RUN}`]);
  // The second tenant needs its own location for the composite FK.
  const otherLocation = uuidv7();
  await admin.query("insert into locations(id,tenant_id,name,is_primary) values ($1,$2,'Other',true)", [otherLocation, otherTenantId]);
  await admin.query("insert into members(id,tenant_id,person_id,location_id,member_code) values ($1,$2,$3,$4,$5)",
    [otherMember, otherTenantId, otherPerson, otherLocation, `OTHER-${RUN}`]);
  await admin.query(`insert into sessions(id,tenant_id,batch_id,location_id,session_date,starts_at,ends_at,status)
    values ($1,$2,$3,$4,'2026-09-28','2026-09-28 07:00+05:30','2026-09-28 08:00+05:30','scheduled')`,
    [sessionB, tenantId, batchB, b]);
  await admin.query(`insert into enrolments(id,tenant_id,member_id,batch_id,enrolled_on)
    values ($1,$2,$3,$4,'2026-09-20')`, [uuidv7(), tenantId, memberB, batchB]);
  await admin.query(`insert into payments(id,tenant_id,member_id,location_id,amount_paise,method)
    values ($1,$3,$4,$6,2500,'cash'),($2,$3,$5,$7,2500,'cash')`,
    [paymentA, paymentB, tenantId, memberA, memberB, a, b]);
  await admin.query(`insert into payment_reversals(id,tenant_id,payment_id,amount_paise,reason)
    values ($1,$3,$4,500,'A correction'),($2,$3,$5,500,'B private correction')`,
    [uuidv7(), uuidv7(), tenantId, paymentA, paymentB]);
}, 60_000);

afterAll(async () => {
  // The positive attendance action queues analytics after commit. Do not
  // leave that job for another suite's queue-fetch assertion to claim.
  await admin.query("delete from pgboss.job where data->>'tenantId'=$1", [tenantId]);
  for (const id of [tenantId, otherTenantId]) {
    await deleteAuditRowsForTenant(admin, id);
    for (const table of ["payment_reversals", "payments", "attendance", "enrolments", "sessions", "batches", "members", "consents", "guardianships", "persons", "programs", "config_values", "membership_locations", "tenant_memberships", "roles", "locations"]) {
      await admin.query(`delete from ${table} where tenant_id=$1`, [id]);
    }
    await admin.query("delete from tenants where id=$1", [id]);
  }
  await admin.query("delete from users where id=any($1::uuid[])", [[userOwner, userAdmin, userScopedOwner, userReception, userAccountant]]);
  for (const key of ["owner", "admin", "scopedOwner", "reception", "accountant"]) {
    const id = `boundary-${key}-${RUN}`;
    await admin.query("delete from ba_session where user_id=$1", [id]);
    await admin.query("delete from ba_account where user_id=$1", [id]);
    await admin.query("delete from ba_user where id=$1", [id]);
  }
  await admin.end();
});

describe("authenticated authorization boundaries", () => {
  it("H01 rejects a scoped enrolment into another location", async () => {
    await signIn("reception");
    expect(await enrolMemberAction({ memberId: memberA, batchId: batchB })).toMatchObject({ ok: false });
    expect((await admin.query("select id from enrolments where tenant_id=$1 and member_id=$2", [tenantId, memberA])).rowCount).toBe(0);
    expect(await enrolMemberAction({ memberId: memberA, batchId: batchA })).toMatchObject({ ok: true });
  });

  it("H01 rejects a missing actor while allowing explicitly authorized broader access", async () => {
    expect(await enrolMember({ tenantId }, { memberId: memberA, batchId: batchB })).toMatchObject({ ok: false });
    await signIn("owner");
    expect(await enrolMemberAction({ memberId: memberA, batchId: batchB })).toMatchObject({ ok: true });
    expect(await enrolMemberAction({ memberId: otherMember, batchId: batchB })).toMatchObject({ ok: false });
  });

  it("H02 refuses a member outside the session roster and permits an enrolled member", async () => {
    await signIn("owner");
    await expect(markAttendanceSessionAction({ sessionId: sessionB, memberId: outsiderA,
      status: "present", clientId: `nonroster-${RUN}` })).rejects.toThrow();
    expect((await admin.query("select id from attendance where session_id=$1 and member_id=$2", [sessionB, outsiderA])).rowCount).toBe(0);
    expect(await markAttendanceSessionAction({ sessionId: sessionB, memberId: memberB,
      status: "present", clientId: `roster-${RUN}` })).toMatchObject({ ok: true });
    await expect(markAttendanceSessionAction({ sessionId: sessionB, memberId: otherMember,
      status: "present", clientId: `foreign-${RUN}` })).rejects.toThrow();
    await signIn("reception");
    expect(await markAttendanceSessionAction({ sessionId: sessionB, memberId: memberB,
      status: "present", clientId: `foreign-site-${RUN}` })).toMatchObject({ ok: false, error: "Session not found." });
  });

  it("H03 denies receptionist issuance and invalid or out-of-location targets", async () => {
    await signIn("reception");
    expect(await issueParentLinkAction({ memberId: memberA })).toMatchObject({ kind: "error" });
    await signIn("scopedOwner");
    expect(await issueParentLinkAction({ memberId: memberB })).toMatchObject({ kind: "error" });
    await signIn("owner");
    expect(await issueParentLinkAction({ memberId: uuidv7() })).toMatchObject({ kind: "error" });
    expect(await issueParentLinkAction({ memberId: otherMember })).toMatchObject({ kind: "error" });
    expect(await issueParentLinkAction({ memberId: memberB })).toMatchObject({ kind: "ok" });
    await signIn("admin");
    expect(await issueParentLinkAction({ memberId: memberA })).toMatchObject({ kind: "ok" });
  });

  it("M01 does not disclose another site's reversal but lets an all-sites owner read it", async () => {
    await signIn("accountant");
    expect(await listPaymentReversalsAction(paymentB)).toEqual([]);
    expect(await listPaymentReversalsAction(paymentA)).toMatchObject([{ reason: "A correction" }]);
    await signIn("owner");
    expect(await listPaymentReversalsAction(paymentB)).toMatchObject([{ reason: "B private correction" }]);
  });

  it("H01 lets an explicitly identified system actor enrol without a staff identity", async () => {
    expect(await enrolMember({ tenantId, systemActor: true },
      { memberId: outsiderA, batchId: batchB })).toMatchObject({ ok: true });
  });
});
