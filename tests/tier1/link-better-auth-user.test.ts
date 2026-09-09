import { Pool } from "pg";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import { linkBetterAuthUser } from "@/db/platform";

// L1 / M2 — linkBetterAuthUser canonicalises the phone. better-auth
// hands the callback `919000000001`; the seed/store path stores
// `+919000000001`. Without canonicalisation at the write seam, the
// upsert misses the existing row (different `users.phone` value),
// inserts a second one, and the next login loses its membership
// lookup. This test exercises the exact seam against real DB state:
//   1. seed a row at canonical E.164
//   2. simulate better-auth passing the no-prefix form
//   3. assert that linkBetterAuthUser updates the seeded row,
//      not inserts a duplicate

const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });

const TEST_PHONE_CANONICAL = "+919000000901";
const TEST_PHONE_STRIPPED = "919000000901";
let seededUserId: string;

beforeAll(async () => {
  // Clean any prior runs of this test (the run is deterministic
  // by phone digits). Seed a row with the canonical phone and
  // a synthetic user_id we can verify against.
  seededUserId = uuidv7();
  await admin.query(
    `delete from users where phone in ($1, $2) or regexp_replace(phone, '[^0-9]', '', 'g') = '919000000901'`,
    [TEST_PHONE_CANONICAL, TEST_PHONE_STRIPPED],
  );
  await admin.query(
    `insert into users (id, phone, better_auth_id) values ($1, $2, NULL)`,
    [seededUserId, TEST_PHONE_CANONICAL],
  );
});

afterAll(async () => {
  await admin.query(
    `delete from users where id in (select id from users where regexp_replace(phone, '[^0-9]', '', 'g') = '919000000901')`,
  );
  await admin.end();
});

describe("linkBetterAuthUser canonicalises phone (M2)", () => {
  it("updates the seeded canonical row when better-auth sends the stripped form", async () => {
    const betterAuthUserId = `m2-test-${uuidv7()}`;
    // Simulates better-auth's phone plugin handing the callback the
    // raw input without the leading +.
    const returnedId = await linkBetterAuthUser(betterAuthUserId, TEST_PHONE_STRIPPED);
    expect(returnedId).toBe(seededUserId);

    // The seeded row now carries the better_auth_id we just minted.
    // No second row was created at the stripped phone.
    const rows = await admin.query<{ id: string; phone: string; better_auth_id: string }>(
      `select id, phone, better_auth_id from users where id = $1`,
      [seededUserId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.phone).toBe(TEST_PHONE_CANONICAL);
    expect(rows.rows[0]!.better_auth_id).toBe(betterAuthUserId);

    // No orphan row at the stripped phone form.
    const orphans = await admin.query<{ phone: string }>(
      `select phone from users where regexp_replace(phone, '[^0-9]', '', 'g') = '919000000901' and phone <> $1`,
      [TEST_PHONE_CANONICAL],
    );
    expect(orphans.rows).toHaveLength(0);
  });

  it("is idempotent under repeated calls — same row, same id", async () => {
    const a = await linkBetterAuthUser(`m2-test-${uuidv7()}`, TEST_PHONE_CANONICAL);
    const b = await linkBetterAuthUser(`m2-test-${uuidv7()}`, TEST_PHONE_STRIPPED);
    expect(a).toBe(seededUserId);
    expect(b).toBe(seededUserId);

    const count = await admin.query<{ n: string }>(
      `select count(*)::text as n from users where regexp_replace(phone, '[^0-9]', '', 'g') = '919000000901'`,
    );
    expect(count.rows[0]!.n).toBe("1");
  });

  it("writes canonical E.164 when no row exists (no seed, no orphan)", async () => {
    const phoneCanonical = "+919000000902";
    const phoneStripped = "919000000902";
    await admin.query(
      `delete from users where regexp_replace(phone, '[^0-9]', '', 'g') = '919000000902'`,
    );

    const id = await linkBetterAuthUser(`m2-test-${uuidv7()}`, phoneStripped);
    expect(id).toBeTruthy();
    const rows = await admin.query<{ phone: string }>(
      `select phone from users where id = $1`,
      [id],
    );
    // Wrote the canonical form, not the stripped better-auth form.
    expect(rows.rows[0]!.phone).toBe(phoneCanonical);

    await admin.query(`delete from users where id = $1`, [id]);
  });
});

// Same user id across calls — the canonicalised-phone merge
// keeps a single row even when better-auth hands a different
// shape on each call.
describe("linkBetterAuthUser round-trips a single row across mixed inputs", () => {
  it("returns the same user id for stripped + canonical + 91XXXX inputs", async () => {
    const phoneCanonical = "+919000000904";
    const phoneStripped = "919000000904";
    const phone91 = "919000000904";
    // Clean any prior test residue.
    await admin.query(
      `delete from users where regexp_replace(phone, '[^0-9]', '', 'g') = '919000000904'`,
    );
    const newId = await linkBetterAuthUser(`m2-test-${uuidv7()}`, phoneStripped);
    const sameId = await linkBetterAuthUser(`m2-test-${uuidv7()}`, phone91);
    const sameId2 = await linkBetterAuthUser(`m2-test-${uuidv7()}`, phoneCanonical);
    expect(newId).toBeTruthy();
    expect(sameId).toBe(newId);
    expect(sameId2).toBe(newId);

    const count = await admin.query<{ n: string }>(
      `select count(*)::text as n from users where regexp_replace(phone, '[^0-9]', '', 'g') = '919000000904'`,
    );
    expect(count.rows[0]!.n).toBe("1");

    const row = await admin.query<{ phone: string }>(
      `select phone from users where id = $1`,
      [newId],
    );
    // The last writer used the canonical form.
    expect(row.rows[0]!.phone).toBe(phoneCanonical);

    await admin.query(`delete from users where id = $1`, [newId]);
  });
});

// Reference assertion: a never-seeded user phone where no row
// ever existed can still be linked, and the seam tolerates
// mixed input shapes. Sanity check that the canonicaliser doesn't
// reject anything the auth callback could hand it.
describe("normaliseToE164 covers every shape better-auth can deliver", () => {
  it("writes canonical E.164 for a never-seeded phone on first contact", async () => {
    const phone = "+919000000903";
    const stripped = "919000000903";
    await admin.query(
      `delete from users where regexp_replace(phone, '[^0-9]', '', 'g') = '919000000903'`,
    );
    const id = await linkBetterAuthUser(`m2-test-${uuidv7()}`, stripped);
    expect(id).toBeTruthy();
    const rows = await admin.query<{ phone: string }>(
      `select phone from users where id = $1`,
      [id],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.phone).toBe(phone);
    await admin.query(`delete from users where id = $1`, [id]);
  });
});
