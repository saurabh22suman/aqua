import { afterAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { seedRoleTemplates } from "@/lib/services/roles";
import { asTenantId, type TenantId } from "@/lib/ids";
import { formatPhoneIN } from "@/lib/phone";
import CoachMePage from "@/app/(coach)/coach/me/page";

// F4 (mobile UX plan v2, Phase 0) — the coach "Me" tab crashed with
// ForbiddenError because the page called
// requirePermission(ctx, "members.read"), and the coach role does not
// (and should not) hold members.read. The guard above the page
// (requireCoach) is the correct authorization boundary; the page only
// needs the signed-in user's own identity.
//
// This drives the real page with a real coach membership and a real
// DB, the same shape as batch-detail-page.test.ts. Mutation proof:
// re-adding `requirePermission(ctx, "members.read")` to the page turns
// this test red again.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const { authUser } = vi.hoisted(() => ({ authUser: { betterAuthId: "" } }));
vi.mock("@/lib/auth/server", () => ({
  auth: {
    api: {
      getSession: async () => ({
        user: { id: authUser.betterAuthId },
        session: { createdAt: new Date() },
      }),
    },
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (path: string) => {
    throw new Error(`unexpected redirect: ${path}`);
  },
}));

const RUN = Date.now().toString(36);
const TZ = "Asia/Kolkata";
// Digits-only, unique per run. The previous `+9190${RUN}0002` was
// flaky: RUN is base36, so after formatPhoneIN strips the letters the
// remaining digits sometimes formed a formatable 10-digit number and
// sometimes did not, which made the assertion below pass or fail by
// wall-clock luck.
const COACH_PHONE = `+9198${String(Date.now()).slice(-8)}`;

const created: { tenantId: TenantId; userId: string }[] = [];

afterAll(async () => {
  for (const { tenantId, userId } of created) {
    await admin.query("delete from staff where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from persons where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from tenant_memberships where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from roles where tenant_id = $1::uuid", [tenantId]);
    await admin.query("delete from users where id = $1::uuid", [userId]);
    await admin.query("delete from tenants where id = $1::uuid", [tenantId]);
  }
  await admin.end();
});

async function setup() {
  const tenantId = asTenantId(uuidv7());
  const userId = uuidv7();
  const betterAuthId = `f4-coach-me-${RUN}-${uuidv7().slice(0, 8)}`;

  await admin.query(
    "insert into tenants (id, slug, name, status, timezone) values ($1, $2, 'F4 Coach Me', 'active', $3)",
    [tenantId, `f4-coach-me-${RUN}-${uuidv7().slice(0, 8)}`, TZ],
  );
  await seedRoleTemplates(tenantId);
  const coachRoleId = (
    await admin.query<{ id: string }>(
      "select id from roles where tenant_id = $1 and key = 'coach'",
      [tenantId],
    )
  ).rows[0]!.id;

  await admin.query(
    "insert into users (id, phone, better_auth_id) values ($1, $2, $3)",
    [userId, COACH_PHONE, betterAuthId],
  );
  await admin.query(
    "insert into tenant_memberships (id, tenant_id, user_id, role_id, all_locations, status) values ($1, $2, $3, $4, true, 'active')",
    [uuidv7(), tenantId, userId, coachRoleId],
  );

  const personId = uuidv7();
  await admin.query(
    "insert into persons (id, tenant_id, full_name, date_of_birth) values ($1, $2, 'Coach Me Subject', '1990-01-01')",
    [personId, tenantId],
  );
  await admin.query(
    "insert into staff (id, tenant_id, person_id, user_id, staff_type) values ($1, $2, $3, $4, 'coach')",
    [uuidv7(), tenantId, personId, userId],
  );

  created.push({ tenantId, userId });
  authUser.betterAuthId = betterAuthId;
}

function renderToString(node: unknown): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(renderToString).join("");
  if (typeof node === "object" && "props" in (node as Record<string, unknown>)) {
    const props = (node as { props: { children?: unknown } }).props;
    return renderToString(props.children);
  }
  return "";
}

describe("CoachMePage — no members.read permission required (F4)", () => {
  it("renders the identity block and sign-out for a real coach membership", async () => {
    await setup();

    const result = await CoachMePage();
    const rendered = renderToString(result);

    expect(rendered).toContain("Coach Me Subject");
    expect(rendered).toContain(formatPhoneIN(COACH_PHONE));
    expect(rendered).not.toContain(COACH_PHONE);
    expect(rendered).toContain("Sign out");
  });

  it("does not call requirePermission(members.read) — source guard", () => {
    // The behavioural test above is the load-bearing proof; this source
    // guard makes the mutation proof cheap (re-adding the line fails
    // here even if a future fixture accidentally grants the role the
    // permission).
    const source = readFileSync(
      "app/(coach)/coach/me/page.tsx",
      "utf8",
    ) as string;
    expect(source).not.toContain('requirePermission(ctx, "members.read")');
  });
});
