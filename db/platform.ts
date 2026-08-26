import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";

export type TenantAccess = {
  userId: string;
  tenantId: string;
  membershipId: string;
  roleKey: string;
  roleId: string;
  allLocations: boolean;
};

export async function resolveTenantAccessBySlug(
  betterAuthUserId: string,
  slug: string,
): Promise<TenantAccess | null> {
  const pool = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
  try {
    const result = await pool.query<TenantAccess>(
      `
      select u.id            as "userId",
             t.id            as "tenantId",
             m.id            as "membershipId",
             r.key           as "roleKey",
             r.id            as "roleId",
             m.all_locations as "allLocations"
      from tenants t
      join tenant_memberships m
        on m.tenant_id = t.id
       and m.status = 'active'
       and m.deleted_at is null
      join users u on u.id = m.user_id
      join roles r
        on r.id = m.role_id
       and r.tenant_id = m.tenant_id
      where u.better_auth_id = $1
        and t.slug = $2
      limit 1
      `,
      [betterAuthUserId, slug],
    );
    return result.rows[0] ?? null;
  } finally {
    await pool.end();
  }
}

export async function linkBetterAuthUser(
  betterAuthUserId: string,
  phoneNumber: string,
): Promise<void> {
  const pool = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
  try {
    await pool.query(
      `
      insert into users (id, better_auth_id, phone)
      values ($1, $2, $3)
      on conflict (phone) do update
        set better_auth_id = excluded.better_auth_id,
            updated_at = now()
      `,
      [uuidv7(), betterAuthUserId, phoneNumber],
    );
  } finally {
    await pool.end();
  }
}

export async function resolveLocationIds(
  tenantId: string,
  membershipId: string,
  allLocations: boolean,
): Promise<string[]> {
  const pool = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
  try {
    if (allLocations) {
      const result = await pool.query<{ id: string }>(
        "select id from locations where tenant_id = $1 and deleted_at is null",
        [tenantId],
      );
      return result.rows.map((r) => r.id);
    }
    const result = await pool.query<{ id: string }>(
      "select location_id as id from membership_locations where membership_id = $1",
      [membershipId],
    );
    return result.rows.map((r) => r.id);
  } finally {
    await pool.end();
  }
}

const ROLE_HOME: Record<string, string> = {
  owner: "/owner",
  admin: "/owner",
  coach: "/coach",
  parent: "/parent",
};

export async function resolveHomePath(
  betterAuthUserId: string,
): Promise<string | null> {
  const pool = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
  try {
    const result = await pool.query<{ roleKey: string }>(
      `
      select r.key as "roleKey"
      from tenant_memberships m
      join users u on u.id = m.user_id
      join roles r
        on r.id = m.role_id
       and r.tenant_id = m.tenant_id
      where u.better_auth_id = $1 and m.status = 'active' and m.deleted_at is null
      order by case r.key when 'owner' then 0 when 'admin' then 1 when 'coach' then 2 else 3 end
      limit 1
      `,
      [betterAuthUserId],
    );
    const roleKey = result.rows[0]?.roleKey;
    return roleKey ? ROLE_HOME[roleKey] ?? "/parent" : null;
  } finally {
    await pool.end();
  }
}

export async function resolveDefaultMembership(
  betterAuthUserId: string,
): Promise<{
  tenantId: string;
  membershipId: string;
  roleKey: string;
  roleId: string;
  allLocations: boolean;
} | null> {
  const pool = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
  try {
    const result = await pool.query<{
      tenantId: string;
      membershipId: string;
      roleKey: string;
      roleId: string;
      allLocations: boolean;
    }>(
      `
      select m.tenant_id     as "tenantId",
             m.id            as "membershipId",
             r.key           as "roleKey",
             r.id            as "roleId",
             m.all_locations as "allLocations"
      from tenant_memberships m
      join users u on u.id = m.user_id
      join roles r
        on r.id = m.role_id
       and r.tenant_id = m.tenant_id
      where u.better_auth_id = $1 and m.status = 'active' and m.deleted_at is null
      order by case r.key when 'owner' then 0 when 'admin' then 1 when 'coach' then 2 else 3 end
      limit 1
      `,
      [betterAuthUserId],
    );
    return result.rows[0] ?? null;
  } finally {
    await pool.end();
  }
}
