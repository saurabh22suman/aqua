import { sql } from "drizzle-orm";
import { withTenant } from "@/db/tenant";
import { roles } from "@/db/schema/roles";
import { PERMISSIONS } from "@/db/seed-platform";

const ALL_PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

// `roles.key` exists for seeding and analytics only. Nothing at runtime may
// branch on a role key — F-04's Never. These template keys are referenced
// by seeding code alone.
const ROLE_TEMPLATES: ReadonlyArray<{
  key: string;
  name: string;
  permissions: ReadonlyArray<string>;
}> = [
  { key: "owner", name: "Owner", permissions: ALL_PERMISSION_KEYS },
  {
    key: "admin",
    name: "Administrator",
    permissions: ALL_PERMISSION_KEYS.filter(
      (k) => k !== "staff.pay.read" && k !== "staff.pay.write",
    ),
  },
  {
    key: "accountant",
    name: "Accountant",
    permissions: [
      "invoices.read",
      "invoices.write",
      "payments.read",
      "payments.record",
      "reports.financial",
      "reports.operational",
      "staff.pay.read",
      "members.read",
      "settings.read",
    ],
  },
  {
    key: "receptionist",
    name: "Receptionist",
    // Deliberately excludes every staff.pay.* permission — scope §420: a
    // receptionist who marks staff attendance must not see what the head
    // coach earns.
    permissions: [
      "members.read",
      "members.write",
      "attendance.read",
      "attendance.mark",
      "enquiries.read",
      "enquiries.write",
      "invoices.read",
      "payments.record",
      "bookings.read",
      "bookings.write",
      "staff.attendance",
      "messaging.send",
      "programs.read",
      "settings.read",
    ],
  },
  {
    key: "coach",
    name: "Coach",
    permissions: [
      "attendance.read",
      "attendance.mark",
      "members.read",
      "programs.read",
      "levels.read",
      "levels.assess",
    ],
  },
  {
    key: "worker",
    name: "Worker",
    // scope §195: a worker sees a task list and nothing else.
    permissions: ["staff.roster"],
  },
];

export async function seedRoleTemplates(tenantId: string): Promise<void> {
  await withTenant(tenantId, async (tx) => {
    for (const template of ROLE_TEMPLATES) {
      const [created] = await tx
        .insert(roles)
        .values({
          tenantId,
          key: template.key,
          name: template.name,
          isSystem: true,
        })
        .onConflictDoNothing()
        .returning({ id: roles.id });

      // The role already exists — the tenant's role, possibly renamed or
      // edited. Never touch an existing role: a re-run must not clobber a
      // rename, re-add a revoked permission or revert a grant.
      if (!created) continue;

      for (const permissionKey of template.permissions) {
        await tx.execute(sql`
          insert into role_permissions (tenant_id, role_id, permission_key)
          values (${tenantId}, ${created.id}, ${permissionKey})
          on conflict do nothing
        `);
      }
    }
  });
}
