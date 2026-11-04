// @vitest-environment node
//
// Packet 02 acceptance (PROPOSAL — source not applied).
//
// Existing behaviour measured against the current tree with a real platform
// session and the app role:
//   1. a global Ops read (feature catalogue) writes no operation row today — RED;
//   2. a malformed mutation request writes no refusal row today — RED;
//   3. an anonymous global read returns null, runs nothing and writes nothing
//      (approved rev4 helper contract) — regression guard, green today;
//   4. a global read whose audit cannot be persisted fails closed: it rejects
//      and withholds the read result, writing no row — regression guard.
import { randomBytes } from "node:crypto";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { privilegedFixturePool as admin } from "../../db/privileged-fixture";
import { sha256 } from "@/db/platform-auth-crypto";
import { provisionPlatformUser } from "@/db/platform-auth";

const { jar, faults } = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  faults: { auditStore: false },
}));
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
// Fault seam only: every other write goes through the real writer.
vi.mock("@/db/ops-operation-writer", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/db/ops-operation-writer")>();
  return {
    ...actual,
    appendOpsBoundaryEvent: async (
      ...args: Parameters<typeof actual.appendOpsBoundaryEvent>
    ) => {
      if (faults.auditStore) throw new Error("audit store unavailable");
      return actual.appendOpsBoundaryEvent(...args);
    },
  };
});

import FeaturesPage from "@/app/(platform)/ops/features/page";
import { transitionTenantStatusAction } from "@/lib/actions/platform-tenants";
import { runOpsGlobalRead } from "@/lib/auth/ops-operation";

const RUN = Date.now().toString(36);
let userId = "";
let token = "";

beforeAll(async () => {
  const user = await provisionPlatformUser({
    email: `packet-${RUN}@platform.test`,
    name: "Packet Red",
    password: `p-${RUN}`,
    role: "admin",
  });
  userId = user.id;
  token = randomBytes(32).toString("hex");
  await admin.query(
    "insert into platform_sessions (id,user_id,token_hash,second_factor_passed,expires_at) values ($1::uuid,$2::uuid,$3,true,$4)",
    [uuidv7(), userId, sha256(token), new Date(Date.now() + 3600_000)],
  );
  jar.set("platform_session", token);
});

afterAll(async () => {
  await admin.query("delete from platform_audit_log where actor_id = $1", [userId]);
  await admin.query("delete from platform_sessions where user_id = $1", [userId]);
  await admin.query("delete from platform_users where id = $1", [userId]);
  await admin.end();
});

async function rows(action: string) {
  const result = await admin.query<{
    tenant_id: string | null;
    detail: Record<string, unknown>;
  }>(
    "select tenant_id, detail from platform_audit_log where actor_id = $1 and action = $2",
    [userId, action],
  );
  return result.rows;
}

describe("packet 02 coverage (proposal)", () => {
  it("a global catalogue read writes one success operation row", async () => {
    await FeaturesPage();
    const found = await rows("ops.operation.feature.catalogue.list");
    expect(
      found,
      "no operation row was written for the catalogue read",
    ).toHaveLength(1);
    expect(found[0]!.detail.outcome).toBe("success");
    expect(found[0]!.tenant_id).toBeNull();
  });

  it("a malformed transition request writes one invalid refusal row", async () => {
    const result = await transitionTenantStatusAction(uuidv7(), {
      targetStatus: "not-a-status",
    });
    expect(result.kind).toBe("error");
    const found = await rows("ops.operation.tenant.activate");
    expect(
      found,
      "no invalid refusal row was written for the malformed transition",
    ).toHaveLength(1);
    expect(found[0]!.detail.outcome).toBe("invalid");
    expect(found[0]!.tenant_id).toBeNull();
  });
});

describe("approved global-read contract (regression guards)", () => {
  it("an anonymous global read returns null, runs nothing and writes no row", async () => {
    jar.delete("platform_session");
    let called = false;
    const result = await runOpsGlobalRead(
      "activity.list",
      async () => {
        called = true;
        return ["should-not-run"];
      },
      "ops_page",
    );
    expect(result).toBeNull();
    expect(called).toBe(false);
    expect(await rows("ops.operation.activity.list")).toHaveLength(0);
  });

  it("fails closed when the audit store is unavailable: no result, no row", async () => {
    jar.set("platform_session", token);
    faults.auditStore = true;
    let called = false;
    try {
      await expect(
        runOpsGlobalRead(
          "activity.list",
          async () => {
            called = true;
            return ["secret-result"];
          },
          "ops_page",
        ),
      ).rejects.toThrow(/Ops audit unavailable/);
      expect(called).toBe(true);
      expect(await rows("ops.operation.activity.list")).toHaveLength(0);
    } finally {
      faults.auditStore = false;
    }
  });
});
