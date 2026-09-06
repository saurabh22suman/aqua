import { afterAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { issueParentLinkAction } from "@/lib/actions/parent-link";
import { seedRoleTemplates } from "@/lib/services/roles";
import { asTenantId, type TenantId } from "@/lib/ids";

function findMatchingClose(text: string, openParenIndex: number): string {
  // Walk forward from an opening paren, return the substring up
  // through the matching closing paren. Tracks nesting so
  // `({a: {b: c}})` returns the whole call body. We also
  // skip over string literals so a `(` inside a string doesn't
  // count.
  let depth = 0;
  let i = openParenIndex;
  if (text[i] !== "(") {
    throw new Error(`expected '(' at ${openParenIndex}, got ${text[i]}`);
  }
  let inString: false | "'" | '"' | "`" = false;
  while (i < text.length) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") { i += 2; continue; }
      if (ch === inString) inString = false;
      i++;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      inString = ch;
      i++;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return text.slice(openParenIndex, i + 1);
    }
    i++;
  }
  throw new Error("unmatched paren");
}

// requireDefaultCtx needs a session; stub only the framework edges.
// Better-auth's getSession returns the better-auth user id;
// requireDefaultCtx resolves that to the platform users.id and
// looks up the membership + role, same path a real request takes.
const { authUser } = vi.hoisted(() => ({ authUser: { betterAuthId: "" } }));
vi.mock("@/lib/auth/server", () => ({
  auth: {
    api: {
      getSession: async () => ({ user: { id: authUser.betterAuthId } }),
    },
  },
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
}));

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);

let tenantId: TenantId = asTenantId("");
let memberId = "";
let ownerUserId = "";
let ownerBetterAuthId = "";
let ownerStaffId = "";
const cleanupIds: { table: string; id: string }[] = [];

afterAll(async () => {
  // FK-order cleanup. audit_log references users(id), staff(id),
  // and the member id, so the order is: audit_log → consents →
  // members → staff → tenant_memberships → persons → roles →
  // locations → users → tenants.
  await admin.query("delete from audit_log where tenant_id = $1::uuid", [tenantId]);
  await admin.query("delete from consents where tenant_id = $1::uuid", [tenantId]);
  await admin.query("delete from members where id = $1::uuid", [memberId]);
  await admin.query("delete from staff where id = $1::uuid", [ownerStaffId]);
  await admin.query("delete from tenant_memberships where tenant_id = $1::uuid", [tenantId]);
  await admin.query("delete from persons where tenant_id = $1::uuid", [tenantId]);
  await admin.query("delete from roles where tenant_id = $1::uuid", [tenantId]);
  await admin.query("delete from locations where tenant_id = $1::uuid", [tenantId]);
  await admin.query("delete from users where id = $1::uuid", [ownerUserId]);
  await admin.query("delete from tenants where id = $1::uuid", [tenantId]);
  void cleanupIds;
  await admin.end();
});

describe("J4 — issueParentLinkAction writes an audit row", () => {
  it("every successful issuance writes exactly one audit row carrying staff id, member id, timestamps, and NEVER the token", async () => {
    // Tenant + owner user + member fixture. Same shape as
    // membership-role-scope.test.ts; reused here because the
    // parent-link issuance path requires a logged-in owner, which
    // is the smallest thing requireDefaultCtx() can resolve
    // against without inventing a custom mock.
    tenantId = asTenantId(uuidv7());
    ownerUserId = uuidv7();
    ownerBetterAuthId = `parent-link-ba-${RUN}`;
    memberId = uuidv7();
    ownerStaffId = uuidv7();

    await admin.query(
      "insert into tenants (id, slug, name, status) values ($1, $2, 'PL Audit Test', 'active')",
      [tenantId, `pl-audit-${RUN}`],
    );
    await seedRoleTemplates(tenantId);
    const ownerRole = (
      await admin.query<{ id: string }>(
        "select id from roles where tenant_id = $1 and key = 'owner'",
        [tenantId],
      )
    ).rows[0]!.id;

    const locId = uuidv7();
    await admin.query(
      "insert into locations (id, tenant_id, name, is_primary) values ($1, $2, 'Main', true)",
      [locId, tenantId],
    );

    await admin.query(
      "insert into users (id, phone, better_auth_id) values ($1, $2, $3)",
      [ownerUserId, `pl-owner-${RUN}`, ownerBetterAuthId],
    );

    // staff row so the audit log can resolve ownerStaffId. The
    // audit JSONB carries staffId when one exists; when one
    // doesn't, the field is null. We want both shapes pinned by
    // other tests in this file; this test exercises the with-
    // staff-row path because it's the realistic owner case.
    const personId = uuidv7();
    await admin.query(
      "insert into persons (id, tenant_id, full_name) values ($1, $2, 'Owner Person')",
      [personId, tenantId],
    );
    await admin.query(
      "insert into staff (id, tenant_id, person_id, user_id, staff_type) values ($1, $2, $3, $4, 'receptionist')",
      [ownerStaffId, tenantId, personId, ownerUserId],
    );

    await admin.query(
      "insert into tenant_memberships (id, tenant_id, user_id, role_id, status) values ($1, $2, $3, $4, 'active')",
      [uuidv7(), tenantId, ownerUserId, ownerRole],
    );

    // Member + guardian + consent. The member must exist for the
    // action to land; the action itself doesn't validate the
    // member's existence (the parent-view verifier does that),
    // so a phantom member id still produces an audit row — the
    // point is that the audit write happens unconditionally on
    // a successful issuance, not on a successful click.
    const memberPersonId = uuidv7();
    await admin.query(
      "insert into persons (id, tenant_id, full_name) values ($1, $2, 'Child Person')",
      [memberPersonId, tenantId],
    );
    await admin.query(
      "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, $5, 'active')",
      [memberId, tenantId, memberPersonId, locId, `PL-${RUN}`],
    );

    authUser.betterAuthId = ownerBetterAuthId;

    const result = await issueParentLinkAction({ memberId });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    // The token lives in `url`. Capture it BEFORE looking at the
    // audit row so we can explicitly assert the audit row's JSONB
    // payload does not contain it.
    const tokenFromResult = result.url.replace(/^\/p\//, "");

    const rows = await admin.query<{
      action: string;
      entity_type: string;
      entity_id: string;
      actor_id: string;
      tenant_id: string;
      before: unknown;
      after: { memberId?: string; userId?: string; staffId?: string; issuedAt?: string; expiresAt?: string; scope?: string } | null;
      ip_address: string | null;
    }>(
      `select action, entity_type, entity_id, actor_id, tenant_id, before, after, ip_address
         from audit_log
        where tenant_id = $1::uuid
          and action = 'parent_link.issue'
          and entity_id = $2::uuid`,
      [tenantId, memberId],
    );
    expect(rows.rows.length).toBe(1);
    const row = rows.rows[0]!;

    // Schema fields — exactly what the audit contract says.
    expect(row.action).toBe("parent_link.issue");
    expect(row.entity_type).toBe("parent_link");
    expect(row.entity_id).toBe(memberId);
    expect(row.actor_id).toBe(ownerUserId);
    expect(row.tenant_id).toBe(tenantId);
    expect(row.before).toBeNull();

    // The JSONB payload: staff id, member id, issuedAt, expiresAt,
    // scope — and never the token. (The token is the secret;
    // the audit row is the durability of "who did what", not
    // "what was minted".)
    expect(row.after).not.toBeNull();
    const after = row.after!;
    expect(after.memberId).toBe(memberId);
    expect(after.staffId).toBe(ownerStaffId);
    expect(after.userId).toBe(ownerUserId);
    expect(after.scope).toBe("parent_view");
    expect(typeof after.issuedAt).toBe("string");
    expect(typeof after.expiresAt).toBe("string");

    // The expiresAt must come back from the action too — and
    // match what the audit row recorded, so the operator can
    // see "this link stops working at <expiresAt>" both in the
    // UI and on the audit row.
    expect(after.expiresAt).toBe(result.expiresAt);

    // Never the token. Not in any field, not in any string.
    const auditJson = JSON.stringify({
      action: row.action,
      entity_type: row.entity_type,
      entity_id: row.entity_id,
      after: row.after,
    });
    expect(auditJson).not.toContain(tokenFromResult);
    expect(auditJson).not.toContain(tokenFromResult.split(".")[0]!); // not even the header
    expect(auditJson).not.toContain(tokenFromResult.split(".")[1]!); // not even the payload
  });

  it("issuing without owner role returns 'unauthorized' and writes NO audit row", async () => {
    // The action's permission check happens BEFORE the audit write,
    // so a denied issuance must leave the audit_log empty for this
    // member — otherwise an attacker could spam failed attempts
    // to fill the audit table with noise.
    //
    // Setup: same fixture shape, but a coach (not owner) signs in
    // and tries to issue. assertManagement() throws; the action
    // returns { kind: 'error', code: 'unauthorized' }.
    const tenantB = asTenantId(uuidv7());
    const coachUserId = uuidv7();
    const coachBetterAuthId = `pl-coach-${RUN}`;
    const memberIdB = uuidv7();

    await admin.query(
      "insert into tenants (id, slug, name, status) values ($1, $2, 'PL Deny Test', 'active')",
      [tenantB, `pl-deny-${RUN}`],
    );
    await seedRoleTemplates(tenantB);
    const coachRole = (
      await admin.query<{ id: string }>(
        "select id from roles where tenant_id = $1 and key = 'coach'",
        [tenantB],
      )
    ).rows[0]!.id;

    const locIdB = uuidv7();
    await admin.query(
      "insert into locations (id, tenant_id, name) values ($1, $2, 'Main')",
      [locIdB, tenantB],
    );

    await admin.query(
      "insert into users (id, phone, better_auth_id) values ($1, $2, $3)",
      [coachUserId, `pl-coach-${RUN}`, coachBetterAuthId],
    );

    await admin.query(
      "insert into tenant_memberships (id, tenant_id, user_id, role_id, status) values ($1, $2, $3, $4, 'active')",
      [uuidv7(), tenantB, coachUserId, coachRole],
    );

    const personIdB = uuidv7();
    const memberPersonIdB = uuidv7();
    await admin.query(
      "insert into persons (id, tenant_id, full_name) values ($1, $2, 'Coach'), ($3, $2, 'Child')",
      [personIdB, tenantB, memberPersonIdB],
    );
    await admin.query(
      "insert into staff (id, tenant_id, person_id, user_id, staff_type) values ($1, $2, $3, $4, 'coach')",
      [uuidv7(), tenantB, personIdB, coachUserId],
    );
    await admin.query(
      "insert into members (id, tenant_id, person_id, location_id, member_code, status) values ($1, $2, $3, $4, $5, 'active')",
      [memberIdB, tenantB, memberPersonIdB, locIdB, `PL-COACH-${RUN}`],
    );

    authUser.betterAuthId = coachBetterAuthId;

    const result = await issueParentLinkAction({ memberId: memberIdB });
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("unauthorized");
    }

    const rows = await admin.query<{ n: number }>(
      `select count(*)::int as n from audit_log
        where tenant_id = $1::uuid and action = 'parent_link.issue'`,
      [tenantB],
    );
    expect(rows.rows[0]!.n).toBe(0);

    // Cleanup.
    await admin.query("delete from members where id = $1::uuid", [memberIdB]);
    await admin.query("delete from tenant_memberships where tenant_id = $1::uuid", [tenantB]);
    await admin.query("delete from staff where tenant_id = $1::uuid", [tenantB]);
    await admin.query("delete from persons where tenant_id = $1::uuid", [tenantB]);
    await admin.query("delete from users where id = $1::uuid", [coachUserId]);
    await admin.query("delete from roles where tenant_id = $1::uuid", [tenantB]);
    await admin.query("delete from locations where tenant_id = $1::uuid", [tenantB]);
    await admin.query("delete from tenants where id = $1::uuid", [tenantB]);
  });

  it("invalid input returns 'invalid' and writes NO audit row", async () => {
    const result = await issueParentLinkAction({ memberId: "not-a-uuid" });
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.code).toBe("invalid");
    }
    // No audit row should have landed from a parse-fail.
    const rows = await admin.query<{ n: number }>(
      `select count(*)::int as n from audit_log
        where tenant_id = $1::uuid and action = 'parent_link.issue'`,
      [tenantId],
    );
    expect(rows.rows[0]!.n).toBe(1); // exactly the one from the happy path; nothing more
  });
});

describe("J4 — /p/[token] route handler sets X-Robots-Tag: noindex", () => {
  // The route handler is a Next.js Route Handler, not a regular
  // function we can import without spinning the dev server. The
  // property we need to pin — every response carries the noindex
  // header — is structural enough to assert by source scan: every
  // `new Response(...)` site in the handler must include the
  // header. (The e2e-parent-link-zero-js script's CI run is the
  // live coverage; this is the static pin that catches a future
  // edit that drops the header before it ships.)
  const handlerSrc = readFileSync("app/p/[token]/route.ts", "utf8");

  it("every `new Response(...)` in the handler uses pageHeaders() (the function that carries X-Robots-Tag)", () => {
    // Both the GET and HEAD branches construct Response objects.
    // Pin them: every `new Response(` call must pass pageHeaders()
    // (or include the same headers) so no path bypasses the
    // noindex header. The call body can span many lines
    // (renderParentView's argument block is ~25 lines), so we
    // walk forward to find the matching `)` at the call's top
    // level — not just a fixed window.
    const newResponseCalls = [...handlerSrc.matchAll(/new Response\(/g)];
    expect(newResponseCalls.length).toBeGreaterThan(0);
    for (const call of newResponseCalls) {
      const callBody = findMatchingClose(handlerSrc, call.index! + "new Response(".length - 1);
      expect(
        callBody.includes("pageHeaders"),
        `every new Response() must include pageHeaders() — found one without it (call at index ${call.index})`,
      ).toBe(true);
    }
  });

  it("pageHeaders() carries X-Robots-Tag: noindex", () => {
    expect(handlerSrc).toMatch(/"X-Robots-Tag"\s*:\s*"noindex"/);
  });

  it("pageHeaders() does NOT carry public-cache directives — the page is no-store because it carries personal data", () => {
    // Cache-control: no-store is already pinned by the existing
    // e2e:parent-link-zero-js assertions; the noindex header
    // adds the search-engine half. A future change that swapped
    // no-store for a public cache would re-expose cached
    // responses carrying a specific child's name; both halves of
    // the property must hold together.
    expect(handlerSrc).toMatch(/"Cache-Control"\s*:\s*"no-store"/);
  });
});
