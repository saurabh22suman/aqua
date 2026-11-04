import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { asTenantId, asUserId } from "@/lib/ids";

let container: StartedPostgreSqlContainer;
let admin: Pool;
let challenges: typeof import("@/db/whatsapp-auth");
let complete: typeof import("@/db/whatsapp-auth-complete");
let credentials: typeof import("@/lib/services/credentials");
let destinations: typeof import("@/lib/services/notification-destinations");
let enqueue: typeof import("@/lib/messaging/notification-enqueue");
let worker: typeof import("@/lib/jobs/whatsapp-notifications-job");
let tenantScope: typeof import("@/db/tenant");
const tenantId = asTenantId(randomUUID());
const otherTenantId = asTenantId(randomUUID());
const coachId = asUserId(randomUUID());
const memberId = randomUUID();
const personId = randomUUID();
const guardian1 = randomUUID();
const guardian2 = randomUUID();
const operatorId = randomUUID();
const opsPhone = "+919000008099";
const coachPhone = "+919000008002";
const fetchMock = vi.fn<typeof fetch>();

function lastCode(): string {
  const options = fetchMock.mock.calls.at(-1)?.[1];
  const payload = JSON.parse(String(options?.body)) as { text: { body: string } };
  const code = payload.text.body.match(/code is (\d{6})/)?.[1];
  if (!code) throw new Error("No OTP was dispatched");
  return code;
}

async function cooldown(phone: string) {
  await admin.query("update whatsapp_auth_challenges set created_at = now() - interval '2 hours' where phone = $1", [phone]);
}

beforeAll(async () => {
  container = await new PostgreSqlContainer("postgres:16").start();
  const url = container.getConnectionUri();
  process.env.DATABASE_URL = `postgresql://app_login:wa-test-pw@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`;
  process.env.APP_LOGIN_PASSWORD = "wa-test-pw";
  process.env.BETTER_AUTH_SECRET = "whatsapp-tests-secret-at-least-32-characters";
  process.env.BETTER_AUTH_URL = "http://localhost:3100";
  process.env.WHATSAPP_MOCK_URL = "http://localhost:3000";
  delete process.env.WHATSAPP_PROVIDER;
  const { bootstrapRoles } = await import("@/db/bootstrap-roles");
  await bootstrapRoles(url, "wa-test-pw");
  const { runMigrations } = await import("@/db/migrate");
  await runMigrations(url);
  const { seedPlatformCatalogue } = await import("@/db/seed-platform");
  await seedPlatformCatalogue(url);
  admin = new Pool({ connectionString: url });
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ messages: [{ id: `wamid.test.${randomUUID()}` }] })));
  vi.stubGlobal("fetch", fetchMock);
  challenges = await import("@/db/whatsapp-auth");
  complete = await import("@/db/whatsapp-auth-complete");
  credentials = await import("@/lib/services/credentials");
  destinations = await import("@/lib/services/notification-destinations");
  enqueue = await import("@/lib/messaging/notification-enqueue");
  worker = await import("@/lib/jobs/whatsapp-notifications-job");
  tenantScope = await import("@/db/tenant");
  await admin.query("insert into tenants (id, slug, name, status) values ($1,'wa-tests','WhatsApp Tests','active'),($2,'wa-other','Other Tenant','active')", [tenantId, otherTenantId]);
  const locationId = randomUUID();
  await admin.query("insert into locations (id, tenant_id, name, is_primary) values ($1,$2,'Main',true)", [locationId, tenantId]);
  const { seedRoleTemplates } = await import("@/lib/services/roles");
  await seedRoleTemplates(tenantId);
  await admin.query("insert into users (id, phone) values ($1,$2)", [coachId, coachPhone]);
  await credentials.setCredentialForPhone(coachPhone, "123456");
  await admin.query("insert into tenant_memberships (id,tenant_id,user_id,role_id,status,all_locations) select gen_random_uuid(),$1,$2,id,'active',true from roles where tenant_id=$1 and key='coach'", [tenantId, coachId]);
  await admin.query("insert into platform_users (id,email,name,password_hash,password_salt,phone) values ($1,'wa-tests@aqua.local','WA Operator','unused','unused',$2)", [operatorId, opsPhone]);
  await admin.query("insert into persons (id,tenant_id,full_name,phone,date_of_birth) values ($1,$4,'Student','+919000008101','2015-01-01'),($2,$4,'Guardian One','+919000008102','1980-01-01'),($3,$4,'Guardian Two','+919000008103','1980-01-01')", [personId, guardian1, guardian2, tenantId]);
  await admin.query("insert into members (id,tenant_id,person_id,location_id,member_code,status) values ($1,$2,$3,$4,'WA001','active')", [memberId, tenantId, personId, locationId]);
  await admin.query("insert into guardianships (id,tenant_id,minor_id,guardian_id,relationship,is_primary) values (gen_random_uuid(),$1,$2,$3,'parent',true),(gen_random_uuid(),$1,$2,$4,'parent',false)", [tenantId, personId, guardian1, guardian2]);
  await admin.query("insert into policy_versions (version,content) values ('wa-tests','Synthetic policy')");
  await admin.query("insert into consents (id,tenant_id,person_id,purpose,granted_by,policy_version,evidence) values (gen_random_uuid(),$1,$2,'communications',$3,'wa-tests','{}')", [tenantId, personId, guardian1]);
}, 120_000);

afterAll(async () => {
  vi.unstubAllGlobals();
  const { pool } = await import("@/db/client");
  await pool.end();
  await admin?.end();
  await container?.stop();
});

describe("WhatsApp authentication", () => {
  it("rejects valid legacy Ops OTPs under concurrent verification and replay", async () => {
    const token = await challenges.issueWhatsAppChallenge(opsPhone, "ops_login");
    const code = lastCode();
    const results = await Promise.all([complete.finishOpsWhatsAppLogin(token, code), complete.finishOpsWhatsAppLogin(token, code)]);
    expect(results.every((r) => !r.ok)).toBe(true);
    expect((await complete.finishOpsWhatsAppLogin(token, code)).ok).toBe(false);
    const sessions = await admin.query("select * from platform_sessions where user_id=$1", [operatorId]);
    expect(sessions.rows).toHaveLength(0);
  });

  it("persists five wrong PIN-reset attempts and rejects the correct code afterwards", async () => {
    await cooldown(coachPhone);
    const token = await challenges.issueWhatsAppChallenge(coachPhone, "pin_reset");
    const code = lastCode();
    const wrong = code === "000000" ? "111111" : "000000";
    const results = await Promise.all(Array.from({ length: 5 }, () => complete.verifyPinResetCode(token, wrong)));
    expect(results.every((r) => !r.ok)).toBe(true);
    expect((await complete.verifyPinResetCode(token, code)).ok).toBe(false);
    const attempts = await admin.query("select max(attempts)::int as n from whatsapp_auth_challenges where phone=$1", [coachPhone]);
    expect(attempts.rows[0].n).toBe(5);
  });

  it("rejects expired PIN-reset codes and legacy Ops codes for a suspended operator", async () => {
    await cooldown(coachPhone);
    const token = await challenges.issueWhatsAppChallenge(coachPhone, "pin_reset");
    const code = lastCode();
    await admin.query("update whatsapp_auth_challenges set expires_at=now()-interval '1 second' where phone=$1", [coachPhone]);
    expect((await complete.verifyPinResetCode(token, code)).ok).toBe(false);
    await cooldown(opsPhone);
    const fresh = await challenges.issueWhatsAppChallenge(opsPhone, "ops_login");
    const freshCode = lastCode();
    await admin.query("update platform_users set status='suspended' where id=$1", [operatorId]);
    expect((await complete.finishOpsWhatsAppLogin(fresh, freshCode)).ok).toBe(false);
    await admin.query("update platform_users set status='active' where id=$1", [operatorId]);
  });

  it("throttles resend and invalidates earlier codes when a new code is issued", async () => {
    await cooldown(coachPhone);
    const old = await challenges.issueWhatsAppChallenge(coachPhone, "pin_reset");
    const oldCode = lastCode();
    await expect(challenges.issueWhatsAppChallenge(coachPhone, "pin_reset")).rejects.toThrow("wait");
    await cooldown(coachPhone);
    await challenges.issueWhatsAppChallenge(coachPhone, "pin_reset");
    expect((await complete.verifyPinResetCode(old, oldCode)).ok).toBe(false);
  });

  it("does not dispatch to an unknown number or authorize its challenge", async () => {
    const count = fetchMock.mock.calls.length;
    const token = await challenges.issueWhatsAppChallenge("+919000008999", "ops_login");
    expect(fetchMock.mock.calls.length).toBe(count);
    expect((await complete.finishOpsWhatsAppLogin(token, "123456")).ok).toBe(false);
  });

  it("verifies a coach reset before saving and revokes old sessions atomically", async () => {
    await cooldown(coachPhone);
    const login = await credentials.pinLogin(coachPhone, "123456");
    expect(login.status).toBe(200);
    const token = await challenges.issueWhatsAppChallenge(coachPhone, "pin_reset");
    const code = lastCode();
    expect(await complete.saveResetPin(token, "654321")).toBe(false);
    expect((await complete.verifyPinResetCode(token, code)).ok).toBe(true);
    expect(await complete.saveResetPin(token, "654321")).toBe(true);
    expect(await complete.saveResetPin(token, "111111")).toBe(false);
    const sessions = await admin.query("select count(*)::int as n from ba_session s join users u on u.better_auth_id=s.user_id where u.id=$1", [coachId]);
    expect(sessions.rows[0].n).toBe(0);
    expect((await credentials.pinLogin(coachPhone, "123456")).status).toBe(401);
    expect((await credentials.pinLogin(coachPhone, "654321")).status).toBe(200);
    const audits = await admin.query("select id from platform_audit_log where action='credentials.pin_reset' and target_id=$1", [coachId]);
    expect(audits.rows).toHaveLength(1);
  });

  it("cannot use an ops challenge as tenant PIN recovery", async () => {
    await cooldown(opsPhone);
    const token = await challenges.issueWhatsAppChallenge(opsPhone, "ops_login");
    expect((await complete.verifyPinResetCode(token, lastCode())).ok).toBe(false);
    expect(await complete.saveResetPin(token, "654321")).toBe(false);
  });

  it("rejects cross-origin or wrong-surface HTTP requests before issuing a challenge", async () => {
    const { handleWhatsAppAuth } = await import("@/lib/auth/whatsapp-route");
    const request = (host: string, origin: string) => new Request(`http://${host}/ops/api/whatsapp-auth`, {
      method: "POST", headers: { host, origin, "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "request", phone: opsPhone }),
    });
    const count = fetchMock.mock.calls.length;
    expect((await handleWhatsAppAuth(request("ops.localhost:3100", "http://evil.localhost:3100"), "ops_login")).status).toBe(403);
    expect((await handleWhatsAppAuth(request("localhost:3100", "http://localhost:3100"), "ops_login")).status).toBe(403);
    expect(fetchMock.mock.calls.length).toBe(count);
  });

  it("refuses HTTP Ops WhatsApp login without sending or setting cookies, including old valid challenges", async () => {
    await cooldown(opsPhone);
    const oldToken = await challenges.issueWhatsAppChallenge(opsPhone, "ops_login");
    const code = lastCode();
    const count = fetchMock.mock.calls.length;
    const { handleWhatsAppAuth } = await import("@/lib/auth/whatsapp-route");
    const request = (body: object, cookie = "") => new Request("http://ops.localhost:3100/ops/api/whatsapp-auth", {
      method: "POST", headers: { host: "ops.localhost:3100", origin: "http://ops.localhost:3100",
        "Content-Type": "application/json", cookie }, body: JSON.stringify(body),
    });
    const sent = await handleWhatsAppAuth(request({ intent: "request", phone: opsPhone }), "ops_login");
    const verified = await handleWhatsAppAuth(request({ intent: "verify", code },
      `aqua_whatsapp_ops_login=${oldToken}`), "ops_login");
    for (const response of [sent, verified]) {
      expect(response.status).toBe(403);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    expect(fetchMock.mock.calls.length).toBe(count);
    expect((await admin.query("select id from platform_sessions where user_id=$1", [operatorId])).rows).toEqual([]);
  });

  it("does not expose legacy email or phone sign-in through the public Better Auth handler", async () => {
    const { POST } = await import("@/app/api/auth/[...all]/route");
    for (const path of ["sign-in/email", "sign-in/phone-number", "phone-number/send-otp", "phone-number/verify"]) {
      expect((await POST(new Request(`http://localhost:3100/api/auth/${path}`, {
        method: "POST", body: "{}", headers: { "Content-Type": "application/json" },
      }))).status).toBe(404);
    }
  });
});

describe("notification destinations and delivery", () => {
  const ctx = { tenantId, userId: coachId };
  it("persists multiple linked contacts, supports opt-out and rejects unrelated persons", async () => {
    expect((await destinations.getNotificationDestinations(ctx, memberId))?.contacts).toHaveLength(3);
    expect((await destinations.saveNotificationDestinations(ctx, memberId, [guardian1, guardian2])).ok).toBe(true);
    const saved = await destinations.getNotificationDestinations(ctx, memberId);
    expect(saved?.contacts.filter((c) => c.selected).map((c) => c.personId).sort()).toEqual([guardian1, guardian2].sort());
    expect((await destinations.saveNotificationDestinations(ctx, memberId, [randomUUID()])).ok).toBe(false);
    expect(await destinations.getNotificationDestinations({ tenantId: otherTenantId }, memberId)).toBeNull();
  });

  it("queues each selected number once and concurrent workers do not duplicate sends", async () => {
    const event = { tenantId, eventKey: "test:multi", body: "Synthetic academy announcement" };
    await tenantScope.withTenant(tenantId, async (tx) => {
      expect(await enqueue.enqueueMemberNotification(tx, event, memberId)).toBe(2);
      expect(await enqueue.enqueueMemberNotification(tx, event, memberId)).toBe(0);
    });
    const count = fetchMock.mock.calls.length;
    await Promise.all([worker.runWhatsAppNotificationsJob(tenantId), worker.runWhatsAppNotificationsJob(tenantId)]);
    expect(fetchMock.mock.calls.length - count).toBe(2);
    const rows = await admin.query("select status from whatsapp_notification_outbox where event_key='test:multi'");
    expect(rows.rows.every((r) => r.status === "sent")).toBe(true);
  });

  it("rechecks consent before dispatch and suppresses withdrawn communications", async () => {
    await tenantScope.withTenant(tenantId, (tx) => enqueue.enqueueMemberNotification(tx,
      { tenantId, eventKey: "test:withdrawn", body: "Must not send" }, memberId));
    await admin.query("update consents set withdrawn_at=now() where tenant_id=$1 and purpose='communications'", [tenantId]);
    const count = fetchMock.mock.calls.length;
    await worker.runWhatsAppNotificationsJob(tenantId);
    expect(fetchMock.mock.calls.length).toBe(count);
    const rows = await admin.query("select status from whatsapp_notification_outbox where event_key='test:withdrawn'");
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.every((r) => r.status === "suppressed")).toBe(true);
  });

  it("essential financial notices can reach selected guardians but not a minor's own phone", async () => {
    await destinations.saveNotificationDestinations(ctx, memberId, [personId, guardian1]);
    await tenantScope.withTenant(tenantId, async (tx) => {
      expect(await enqueue.enqueueMemberNotification(tx, { tenantId, eventKey: "test:receipt",
        body: "Synthetic receipt", essential: true }, memberId)).toBe(1);
    });
    await worker.runWhatsAppNotificationsJob(tenantId);
    const row = (await admin.query("select phone,status from whatsapp_notification_outbox where event_key='test:receipt'")).rows[0];
    expect(row).toMatchObject({ phone: "+919000008102", status: "sent" });
  });

  it("empty selection suppresses all student notifications and RLS confines outbox reads", async () => {
    await destinations.saveNotificationDestinations(ctx, memberId, []);
    await tenantScope.withTenant(tenantId, async (tx) => {
      expect(await enqueue.enqueueMemberNotification(tx, { tenantId, eventKey: "test:optout",
        body: "Must not send", essential: true }, memberId)).toBe(0);
    });
    const { whatsappNotificationOutbox } = await import("@/db/schema/whatsapp");
    const rows = await tenantScope.withTenant(otherTenantId, (tx) => tx.select().from(whatsappNotificationOutbox));
    expect(rows).toHaveLength(0);
    const { whatsappAuthChallenges } = await import("@/db/schema/whatsapp");
    expect(await tenantScope.withTenant(otherTenantId, (tx) => tx.select().from(whatsappAuthChallenges))).toHaveLength(0);
  });

  it("parents-only announcements exclude an adult's own selected phone", async () => {
    const adultPerson = randomUUID(), adultMember = randomUUID();
    const [{ location_id: locationId }] = (await admin.query("select location_id from members where id=$1", [memberId])).rows;
    await admin.query("insert into persons(id,tenant_id,full_name,phone,date_of_birth) values($1,$2,'Synthetic adult','+919000008104','1990-01-01')", [adultPerson, tenantId]);
    await admin.query("insert into members(id,tenant_id,person_id,location_id,member_code,status) values($1,$2,$3,$4,'WA-ADULT','active')", [adultMember, tenantId, adultPerson, locationId]);
    await admin.query("insert into consents(id,tenant_id,person_id,purpose,granted_by,policy_version,evidence) values($1,$2,$3,'communications',$3,'wa-tests','{}')", [randomUUID(), tenantId, adultPerson]);
    const { enqueueAnnouncementNotifications } = await import("@/lib/messaging/notification-events");
    const event = { tenantId, announcementId: randomUUID(), title: "Parents only", body: "Synthetic", audience: "parents" };
    expect(await tenantScope.withTenant(tenantId, tx => enqueueAnnouncementNotifications(tx, event))).toBe(0);
    await admin.query("insert into guardianships(id,tenant_id,minor_id,guardian_id,relationship,is_primary) values($1,$2,$3,$4,'parent',true)", [randomUUID(), tenantId, adultPerson, guardian1]);
    await destinations.saveNotificationDestinations(ctx, adultMember, [adultPerson, guardian1]);
    const second = { ...event, announcementId: randomUUID() };
    expect(await tenantScope.withTenant(tenantId, tx => enqueueAnnouncementNotifications(tx, second))).toBe(1);
    const rows = await admin.query("select phone,audience from whatsapp_notification_outbox where event_key=$1", [`announcement:${second.announcementId}`]);
    expect(rows.rows).toEqual([{ phone: "+919000008102", audience: "guardians" }]);
  });

  it("suppresses queued staff notices after their site grant is removed", async () => {
    const locationId = (await admin.query("select location_id from members where id=$1", [memberId])).rows[0].location_id;
    const membership = (await admin.query("select id from tenant_memberships where tenant_id=$1 and user_id=$2", [tenantId, coachId])).rows[0].id;
    await admin.query("update tenant_memberships set all_locations=false where id=$1", [membership]);
    await admin.query("insert into membership_locations(id,tenant_id,membership_id,location_id) values($1,$2,$3,$4)", [randomUUID(), tenantId, membership, locationId]);
    expect(await tenantScope.withTenant(tenantId, tx => enqueue.enqueueStaffNotification(tx,
      { tenantId, eventKey: "test:staff-scope", body: "Synthetic site notice" }, { locationId, coachUserId: coachId }))).toBe(1);
    await admin.query("delete from membership_locations where membership_id=$1", [membership]);
    // Drain the prior guardian announcement first; this event must never send.
    await worker.runWhatsAppNotificationsJob(tenantId);
    const rows = await admin.query("select status from whatsapp_notification_outbox where event_key='test:staff-scope'");
    expect(rows.rows).toEqual([{ status: "suppressed" }]);
  });
});
