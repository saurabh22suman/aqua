import { sql } from "drizzle-orm";
import { withTenant, type TenantTx } from "@/db/tenant";
import { roles } from "@/db/schema/roles";
import { PERMISSIONS } from "@/db/seed-platform";
import type { TenantId } from "@/lib/ids";

const ALL_PERMISSION_KEYS = PERMISSIONS.map((p) => p.key);

// 2026-10-13 role-workflow audit R01 — student attendance is recorded
// by the coach who ran the session or the front desk as backup. Owner
// and Admin keep the completion/status reads (attendance.read,
// reports.operational) but not the marking grant: the owner template is
// "everything" minus attendance.mark, and the admin template is that
// minus staff pay. The action/service layer also refuses owner/admin
// contexts outright, so a stale or accidentally assigned grant on an
// upgraded tenant cannot re-authorize marking.
const OWNER_EXCLUDED_PERMISSIONS = new Set(["attendance.mark"]);
const ADMIN_EXCLUDED_PERMISSIONS = new Set([
  "attendance.mark",
  "staff.pay.read",
  "staff.pay.write",
]);

const OWNER_PERMISSION_KEYS = ALL_PERMISSION_KEYS.filter(
  (k) => !OWNER_EXCLUDED_PERMISSIONS.has(k),
);
const ADMIN_PERMISSION_KEYS = ALL_PERMISSION_KEYS.filter(
  (k) => !ADMIN_EXCLUDED_PERMISSIONS.has(k),
);

// D2: coach holds members.read.assigned (not members.read).
// members.read is the full-roster read granted to owner /
// admin / receptionist; coach only sees members attached to
// their own batches, gated at the service layer
// (lib/services/people.ts) by a JOIN against coach-staff rows.
const COACH_PERMISSION_KEYS = [
  "attendance.read",
  "attendance.mark",
  "members.read.assigned",
  "programs.read",
  "levels.read",
  "levels.assess",
  "staff.self",
] as const;

// Service-layer authority resolution for contexts that carry a role key
// but not the request's resolved permission set (synthetic/legacy
// callers). Template grants are the seed contract; request contexts
// always carry the authoritative resolved set instead, which
// callerHasPermission checks first.
export function roleTemplatePermissionKeys(
  roleKey: string,
): ReadonlySet<string> | null {
  const template = ROLE_TEMPLATES.find((t) => t.key === roleKey);
  if (!template) return null;
  return new Set(template.permissions);
}

// `roles.key` exists for seeding and analytics only. Nothing at runtime may
// branch on a role key — F-04's Never. These template keys are referenced
// by seeding code alone. homePath/homeOrdinal are the data a renamed or
// re-keyed role still carries correctly — see
// db/migrations/0012_roles_home_routing.sql.
const ROLE_TEMPLATES: ReadonlyArray<{
  key: string;
  name: string;
  homePath: string;
  homeOrdinal: number;
  permissions: ReadonlyArray<string>;
}> = [
  // 2026-10-13 role-workflow audit R01/R02 — the owner template is the
  // full catalogue minus attendance.mark (student attendance is
  // execution work) and includes the new levels.write automatically;
  // admin is that minus staff pay.
  { key: "owner", name: "Owner", homePath: "/owner", homeOrdinal: 0, permissions: OWNER_PERMISSION_KEYS },
  {
    key: "admin",
    name: "Administrator",
    homePath: "/owner",
    homeOrdinal: 1,
    permissions: ADMIN_PERMISSION_KEYS,
  },
  {
    key: "accountant",
    name: "Accountant",
    // K3 — pre-demo fix. /parent has no nav and renders just an
    // "<h1>Parent</h1>" stub, so an authenticated accountant used to
    // land on a dead-end mislabeled page. Pointed at /owner for now:
    // the owner surface is read-mostly at the report/dashboard level
    // and an accountant's permissions (invoices.write, payments.record,
    // reports.financial) all work there. A dedicated accountant home is
    // a separate, deliberate product decision — recorded as not-built
    // here, same shape as the worker role further down.
    homePath: "/owner",
    homeOrdinal: 3,
    permissions: [
      "invoices.read",
      "invoices.write",
      "payments.read",
      "payments.record",
      "payments.refund",
      "reports.financial",
      "reports.operational",
      "staff.pay.read",
      "staff.self",
      "members.read",
      "settings.read",
    ],
  },
  {
    key: "receptionist",
    name: "Receptionist",
    homePath: "/reception",
    homeOrdinal: 3,
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
      "invoices.write",
      "payments.record",
      "bookings.read",
      "bookings.write",
      "staff.attendance",
      "staff.self",
      "messaging.send",
      "programs.read",
      "settings.read",
    ],
  },
  {
    key: "coach",
    name: "Coach",
    homePath: "/coach",
    homeOrdinal: 2,
    // D2: coach holds members.read.assigned (not members.read).
    // members.read is the full-roster read granted to owner /
    // admin / receptionist; coach only sees members attached to
    // their own batches, gated at the service layer
    // (lib/services/people.ts) by a JOIN against coach-staff rows.
    permissions: COACH_PERMISSION_KEYS,
  },
  {
    key: "curriculum_lead",
    name: "Curriculum Lead",
    // 2026-10-13 role-workflow audit R02 — the delegated curriculum
    // maintainer. Same coach surface, home ordinal and resource scope
    // as an ordinary coach (assignment + location checks treat it as
    // coach-like), plus the academy-wide levels.write grant. It is a
    // distinct role precisely so ordinary coaches do NOT receive
    // curriculum editing.
    homePath: "/coach",
    homeOrdinal: 2,
    permissions: [...COACH_PERMISSION_KEYS, "levels.write"],
  },
  {
    key: "worker",
    name: "Worker",
    homePath: "/worker",
    homeOrdinal: 3,
    // A05 (2026-10-09 role/content/permission audit) — the worker is
    // self-service only: their own roster, check-in/out and leave.
    // Building, deleting or publishing the roster and approving
    // someone else's leave are staff.roster (owner/admin), so the
    // worker template must not carry that grant.
    permissions: ["staff.self"],
  },
];

// C1 — accepts an optional existing transaction so a caller already
// inside one (createTenant's withPlatformAdmin transaction) can seed
// roles atomically with the tenant/location rows, rather than opening
// a second, independent transaction via withTenant(). Without this,
// role seeding could commit even if the surrounding tenant creation
// later rolled back, or vice versa — exactly the partial-state
// createTenant's own comment says must never happen.
//
// When called with a tx, that transaction must already carry a scope
// permitting an INSERT on roles/role_permissions — withPlatformAdmin's
// app.platform_admin session variable, via the platform_admin_insert
// policy (migration 20260903085505), covers the one caller that needs
// this today.
export async function seedRoleTemplates(tenantId: TenantId, tx?: TenantTx): Promise<void> {
  if (tx) return seedRoleTemplatesOnTx(tenantId, tx);
  return withTenant(tenantId, (innerTx) => seedRoleTemplatesOnTx(tenantId, innerTx));
}

async function seedRoleTemplatesOnTx(tenantId: TenantId, tx: TenantTx): Promise<void> {
  for (const template of ROLE_TEMPLATES) {
    const [created] = await tx
      .insert(roles)
      .values({
        tenantId,
        key: template.key,
        name: template.name,
        homePath: template.homePath,
        homeOrdinal: template.homeOrdinal,
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
}
