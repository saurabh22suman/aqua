import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { env } from "@/lib/env";
import { withTenant } from "@/db/tenant";
import { memberNotes } from "@/db/schema/member-notes";
import { asMemberId, asTenantId, asUserId, type TenantId } from "@/lib/ids";

// U-03 — member notes. Fixtures (tenants/locations/persons/members
// are under FORCE RLS) go through the privileged migration pool;
// every operation under test goes through the service over
// withTenant(), so the RLS and audit assertions exercise the real
// access path. Written before the service existed: the first run is
// deliberately red.

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
const RUN = Date.now().toString(36);

const tenantA = asTenantId(uuidv7());
const tenantB = asTenantId(uuidv7());
const locA = uuidv7();
const locB = uuidv7();
const actor = asUserId(uuidv7());
const memberA = asMemberId(uuidv7());
const memberAPerson = uuidv7();

const ctxA = { tenantId: tenantA, userId: actor, requestId: uuidv7() };
const ctxB = { tenantId: tenantB, userId: actor };

let notes: typeof import("@/lib/services/member-notes");

async function auditRows(tenantId: TenantId, action: string) {
  const { rows } = await admin.query<{
    action: string;
    entity_id: string;
    request_id: string | null;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
  }>(
    "select action, entity_id, request_id, before, after from audit_log where tenant_id = $1 and action = $2 order by created_at",
    [tenantId, action],
  );
  return rows;
}

beforeAll(async () => {
  notes = await import("@/lib/services/member-notes");

  await admin.query(
    `insert into tenants (id, slug, name, status, timezone) values
       ($1, $2, 'Notes A', 'active', 'Asia/Kolkata'),
       ($3, $4, 'Notes B', 'active', 'Asia/Kolkata')`,
    [tenantA, `u03-a-${RUN}`, tenantB, `u03-b-${RUN}`],
  );
  await admin.query(
    `insert into locations (id, tenant_id, name, is_primary) values
       ($1, $3, 'Notes Loc A', true), ($2, $4, 'Notes Loc B', true)`,
    [locA, locB, tenantA, tenantB],
  );
  await admin.query("insert into users (id, phone) values ($1, $2)", [
    actor,
    `+9191${String(Date.now()).slice(-8)}`,
  ]);
  await admin.query(
    `insert into persons (id, tenant_id, full_name, date_of_birth) values
       ($1, $2, 'Aarav Minor', '2016-04-02')`,
    [memberAPerson, tenantA],
  );
  await admin.query(
    `insert into members (id, tenant_id, person_id, location_id, member_code, status, joined_on)
       values ($1, $2, $3, $4, 'NOTE-001', 'active', '2026-01-01')`,
    [memberA, tenantA, memberAPerson, locA],
  );
}, 60_000);

afterAll(async () => {
  await admin.end();
  const client = await import("@/db/client");
  await client.pool.end().catch(() => {});
});

describe("U-03 member notes", () => {
  let noteId = "";

  it("creates a note, lists it, and writes one audit row with the request id", async () => {
    const created = await notes.createMemberNote(ctxA, {
      memberId: memberA,
      body: "Called about the missed Tuesday session.",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    noteId = created.id;

    const listed = await notes.listMemberNotes(ctxA, memberA);
    expect(listed.map((n) => n.body)).toContain(
      "Called about the missed Tuesday session.",
    );

    const audit = await auditRows(tenantA, "member_note.create");
    expect(audit).toHaveLength(1);
    expect(audit[0]?.entity_id).toBe(noteId);
    expect(audit[0]?.request_id).toBe(ctxA.requestId);
  });

  it("rejects an empty body at the service boundary", async () => {
    const empty = await notes.createMemberNote(ctxA, { memberId: memberA, body: "   " });
    expect(empty.ok).toBe(false);
  });

  it("edits a note and audits before/after", async () => {
    const updated = await notes.updateMemberNote(ctxA, {
      noteId,
      body: "Called again — moved to Thursday.",
    });
    expect(updated.ok).toBe(true);

    const listed = await notes.listMemberNotes(ctxA, memberA);
    expect(listed[0]?.body).toBe("Called again — moved to Thursday.");
    expect(listed[0]?.edited).toBe(true);

    const audit = await auditRows(tenantA, "member_note.update");
    expect(audit).toHaveLength(1);
    expect(audit[0]?.before).toMatchObject({
      body: "Called about the missed Tuesday session.",
    });
    expect(audit[0]?.after).toMatchObject({
      body: "Called again — moved to Thursday.",
    });
  });

  it("refuses to touch another tenant's note (RLS + service)", async () => {
    const foreign = await notes.updateMemberNote(ctxB, {
      noteId,
      body: "Cross-tenant edit",
    });
    expect(foreign.ok).toBe(false);

    const listed = await notes.listMemberNotes(ctxB, memberA);
    expect(listed).toEqual([]);

    const direct = await withTenant(tenantB, async (tx) =>
      tx.select({ id: memberNotes.id }).from(memberNotes),
    );
    expect(direct).toEqual([]);
  });

  it("archives a note: soft-deleted, unlisted, audited", async () => {
    const deleted = await notes.deleteMemberNote(ctxA, noteId);
    expect(deleted.ok).toBe(true);

    const listed = await notes.listMemberNotes(ctxA, memberA);
    expect(listed).toEqual([]);

    const { rows } = await admin.query<{ deleted_at: Date | null }>(
      "select deleted_at from member_notes where id = $1",
      [noteId],
    );
    expect(rows[0]?.deleted_at).not.toBeNull();

    const audit = await auditRows(tenantA, "member_note.delete");
    expect(audit).toHaveLength(1);
    expect(audit[0]?.entity_id).toBe(noteId);
  });

  it("reports a missing member as not found, not as a crash", async () => {
    const missing = await notes.createMemberNote(ctxA, {
      memberId: uuidv7(),
      body: "Nowhere",
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toMatch(/not found/i);
  });
});
