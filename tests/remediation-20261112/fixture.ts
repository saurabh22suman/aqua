import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { asTenantId, asUserId, asMemberId } from "@/lib/ids";
import type { Ctx } from "@/lib/auth/context";

export async function fixture() {
  const admin = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL });
  const tenantId = asTenantId(randomUUID());
  const otherTenant = asTenantId(randomUUID());
  const userId = asUserId(randomUUID());
  const managerId = asUserId(randomUUID());
  const receptionistId = asUserId(randomUUID());
  const roleId = randomUUID(), managerRole = randomUUID(), receptionRole = randomUUID();
  const membershipId = randomUUID(), managerMembership = randomUUID(), receptionMembership = randomUUID();
  const locationA = randomUUID(), locationB = randomUUID();
  const programId = randomUUID(), personId = randomUUID(), coachId = randomUUID();
  const batchA = randomUUID(), batchB = randomUUID(), batchUnlocated = randomUUID();
  const memberId = asMemberId(randomUUID()), planId = randomUUID();
  const phone = () => `+91${String(BigInt("0x" + randomUUID().replaceAll("-", "").slice(0, 12)) % 9_000_000_000n + 1_000_000_000n)}`;
  await admin.query("insert into tenants(id,slug,name,status,timezone) values($1,$2,'Remediation A','active','Asia/Kolkata'),($3,$4,'Remediation B','active','Asia/Kolkata')",[tenantId,`fix-${tenantId}`,otherTenant,`fix-${otherTenant}`]);
  await admin.query("insert into users(id,phone) values($1,$2),($3,$4),($5,$6)",[userId,phone(),managerId,phone(),receptionistId,phone()]);
  await admin.query("insert into roles(id,tenant_id,key,name,home_path,home_ordinal) values($1,$4,'owner','Owner','/owner',0),($2,$4,'manager','Manager','/owner',1),($3,$4,'receptionist','Reception','/reception',3)",[roleId,managerRole,receptionRole,tenantId]);
  // The synthetic contexts below claim these grants, so provision the same
  // grants on their real roles for live permission checks.
  await admin.query("insert into role_permissions(tenant_id,role_id,permission_key) select $1,r.id,p.key from unnest($2::uuid[]) r(id) cross join (values ('programs.read'),('programs.write'),('members.read'),('attendance.mark'),('attendance.read'),('settings.manage')) p(key)",[tenantId,[roleId,managerRole,receptionRole]]);
  await admin.query("insert into tenant_memberships(id,tenant_id,user_id,role_id,status,all_locations) values($1,$4,$5,$8,'active',true),($2,$4,$6,$9,'active',false),($3,$4,$7,$10,'active',true)",[membershipId,managerMembership,receptionMembership,tenantId,userId,managerId,receptionistId,roleId,managerRole,receptionRole]);
  await admin.query("insert into locations(id,tenant_id,name,is_primary) values($1,$3,'A',true),($2,$3,'B',false)",[locationA,locationB,tenantId]);
  await admin.query("insert into membership_locations(id,tenant_id,membership_id,location_id) values($1,$2,$3,$4)",[randomUUID(),tenantId,managerMembership,locationA]);
  await admin.query("insert into persons(id,tenant_id,full_name) values($1,$2,'Synthetic member')",[personId,tenantId]);
  await admin.query("insert into members(id,tenant_id,person_id,location_id,status,member_code) values($1,$2,$3,$4,'active','FIX')",[memberId,tenantId,personId,locationA]);
  await admin.query("insert into membership_plans(id,tenant_id,name,kind,duration_days,amount_paise,location_id) values($1,$2,'Monthly','duration',30,10000,$3)",[planId,tenantId,locationA]);
  await admin.query("insert into programs(id,tenant_id,name) values($1,$2,'Programme')",[programId,tenantId]);
  await admin.query("insert into staff(id,tenant_id,person_id,user_id,staff_type) values($1,$2,$3,$4,'coach')",[coachId,tenantId,personId,userId]);
  await admin.query("insert into batches(id,tenant_id,program_id,name,capacity,days_of_week,start_time,end_time,location_id,coach_id) values($1,$4,$5,'Batch A',10,ARRAY[1],'10:00','11:00',$6,$8),($2,$4,$5,'Private batch B',10,ARRAY[1],'10:00','11:00',$7,$8),($3,$4,$5,'Whole club batch',10,ARRAY[1],'10:00','11:00',null,$8)",[batchA,batchB,batchUnlocated,tenantId,programId,locationA,locationB,coachId]);
  function context(id = userId, key = "owner"): Ctx {
    return {tenantId,userId:id,membershipId:key==="manager"?managerMembership:key==="receptionist"?receptionMembership:membershipId,roleId:key==="manager"?managerRole:key==="receptionist"?receptionRole:roleId,roleKey:key,slug:`fix-${tenantId}`,allLocations:key!=="manager",locationIds:key==="manager"?[locationA]:[locationA,locationB],permissions:new Set(["programs.read","programs.write","members.read","attendance.mark","attendance.read","settings.manage"]),features:new Set(["programs","members","attendance","settings"])};
  }
  async function cleanup() {
    const client = await admin.connect();
    try {
      await client.query("begin");
      // Only this fixture's UUIDs are removed. Immutable audit evidence stays.
      const { rows: identities } = await client.query<{ better_auth_id: string | null }>(
        "select better_auth_id from users where id=any($1::uuid[])", [[userId,managerId,receptionistId]]);
      const tables = ["receipts","account_entries","payments","invoice_line_items","invoices",
        "subscriptions","attendance","enrolments","sessions","membership_locations",
        "role_permissions","tenant_memberships","batches","staff","membership_plans",
        "programs","members","persons","locations","roles"];
      for (const table of tables) {
        await client.query(`delete from "${table}" where tenant_id=any($1::uuid[])`, [[tenantId,otherTenant]]);
      }
      await client.query("delete from tenants where id=any($1::uuid[])", [[tenantId,otherTenant]]);
      // Audit actors are immutable historical identities. Retain referenced users
      // without any memberships or sign-in credentials; remove unused actors.
      await client.query("delete from users where id=any($1::uuid[]) and not exists (select 1 from audit_log where actor_id=users.id)", [[userId,managerId,receptionistId]]);
      const baIds = identities.flatMap(row => row.better_auth_id ? [row.better_auth_id] : []);
      if (baIds.length) await client.query("delete from ba_user where id=any($1::text[])", [baIds]);
      await client.query("commit");
    } catch (error) {
      await client.query("rollback");throw error;
    } finally { client.release();await admin.end(); }
  }
  return {admin,cleanup,tenantId,otherTenant,userId,managerId,receptionistId,managerMembership,roleId,membershipId,locationA,locationB,programId,personId,coachId,batchA,batchB,batchUnlocated,memberId,planId,context};
}
