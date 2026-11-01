// @vitest-environment node
//
// Slice-1 acceptance (PROPOSAL — the page wiring is not applied).
//
// Requirement: an authenticated Ops operator who requests ANY changed
// tenant entrypoint with a MALFORMED tenant id must leave exactly one
// authenticated `invalid` operation row with tenant_id NULL before the same
// friendly 404, and the raw value must never be persisted.
//
// Composition note: in the real App Router a malformed tenant URL aborts in
// the shared layout, so the only invalid row is `tenant.header`. The layout
// case proves that abort; the per-page cases are DIRECT-INVOCATION seam
// coverage, not route-composition proof, and do not claim per-route rows.
//
// Measured against the current tree (requireUuidParam before any boundary)
// this fails: no row is written. That failure is the RED for the proposal.
import { randomBytes } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
import { sha256 } from "@/db/platform-auth-crypto";
import { provisionPlatformUser } from "@/db/platform-auth";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.has(name) ? { name, value: jar.get(name)! } : undefined,
    set: (a: { name: string; value: string }) => {
      jar.set(a.name, a.value);
    },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (path: string) => {
    throw new Error(`REDIRECT:${path}`);
  },
}));

import TenantDetailLayout from "@/app/(platform)/ops/tenants/[tenantId]/layout";
import PlatformTenantDetailPage from "@/app/(platform)/ops/tenants/[tenantId]/page";
import TenantAuditPage from "@/app/(platform)/ops/tenants/[tenantId]/audit/page";
import TenantEntitlementsPage from "@/app/(platform)/ops/tenants/[tenantId]/entitlements/page";
import TenantLocationsPage from "@/app/(platform)/ops/tenants/[tenantId]/locations/page";
import TenantMessagingPage from "@/app/(platform)/ops/tenants/[tenantId]/messaging/page";
import EffectiveConfigurationPage from "@/app/(platform)/ops/tenants/[tenantId]/configuration/page";

const RUN = Date.now().toString(36);
let userId = "";
let rawSeq = 0;
const rawId = () => `NOT-A-UUID-${RUN}-${++rawSeq}`;

beforeAll(async () => {
  const user = await provisionPlatformUser({
    email: `invalid-audit-${RUN}@platform.test`,
    name: "Invalid Audit",
    password: `p-${RUN}`,
    role: "admin",
  });
  userId = user.id;
  const token = randomBytes(32).toString("hex");
  await admin.query(
    "insert into platform_sessions (id,user_id,token_hash,second_factor_passed,expires_at) values ($1::uuid,$2::uuid,$3,true,$4)",
    [uuidv7(), userId, sha256(token), new Date(Date.now() + 3600_000)],
  );
  jar.set("platform_session", token);
});

beforeEach(async () => {
  await admin.query("delete from platform_audit_log where actor_id = $1", [userId]);
});

afterAll(async () => {
  await admin.query("delete from platform_audit_log where actor_id = $1", [userId]);
  await admin.query("delete from platform_sessions where user_id = $1", [userId]);
  await admin.query("delete from platform_users where id = $1", [userId]);
  await admin.end();
});

type Case = {
  name: string;
  action: string;
  call: (tenantId: string) => Promise<unknown>;
};

const CASES: Case[] = [
  {
    name: "overview",
    action: "tenant.detail",
    call: (tenantId) => PlatformTenantDetailPage({ params: Promise.resolve({ tenantId }) }),
  },
  {
    name: "audit",
    action: "tenant.detail",
    call: (tenantId) => TenantAuditPage({ params: Promise.resolve({ tenantId }) }),
  },
  {
    name: "entitlements",
    action: "tenant.detail",
    call: (tenantId) => TenantEntitlementsPage({ params: Promise.resolve({ tenantId }) }),
  },
  {
    name: "locations",
    action: "tenant.detail",
    call: (tenantId) => TenantLocationsPage({ params: Promise.resolve({ tenantId }) }),
  },
  {
    name: "messaging",
    action: "tenant.messaging.summary",
    call: (tenantId) => TenantMessagingPage({ params: Promise.resolve({ tenantId }) }),
  },
  {
    name: "configuration",
    action: "config.effective.read",
    call: (tenantId) =>
      EffectiveConfigurationPage({
        params: Promise.resolve({ tenantId }),
        searchParams: Promise.resolve({}),
      }),
  },
];

describe("route composition: a malformed tenant id aborts at the layout", () => {
  it("writes exactly one tenant.header invalid row, never a page row", async () => {
    const id = rawId();
    await expect(
      TenantDetailLayout({
        params: Promise.resolve({ tenantId: id }),
        children: null,
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");

    const { rows } = await admin.query<{
      action: string;
      tenant_id: string | null;
      detail: Record<string, unknown>;
    }>(
      "select action, tenant_id, detail from platform_audit_log where actor_id = $1",
      [userId],
    );
    expect(rows, "the aborted route must write one header row").toHaveLength(1);
    expect(rows[0]!.action).toBe("ops.operation.tenant.header");
    expect(rows[0]!.tenant_id).toBeNull();
    expect(rows[0]!.detail.outcome).toBe("invalid");
    expect(JSON.stringify(rows[0]!.detail)).not.toContain(id);
  });
});

describe("direct page seam coverage (not route composition)", () => {
  it.each(CASES)(
    "$name seam: exactly one invalid row, no tenant, no raw value",
    async ({ action, call }) => {
      const id = rawId();
      await expect(call(id)).rejects.toThrow("NEXT_NOT_FOUND");

      const { rows } = await admin.query<{
        action: string;
        tenant_id: string | null;
        detail: Record<string, unknown>;
      }>(
        "select action, tenant_id, detail from platform_audit_log where actor_id = $1",
        [userId],
      );
      expect(
        rows,
        "no invalid ops row was written before the 404",
      ).toHaveLength(1);
      expect(rows[0]!.action).toBe(`ops.operation.${action}`);
      expect(rows[0]!.tenant_id).toBeNull();
      expect(rows[0]!.detail.outcome).toBe("invalid");
      expect(JSON.stringify(rows[0]!.detail)).not.toContain(id);
    },
  );
});
