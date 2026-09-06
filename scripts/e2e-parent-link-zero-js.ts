// H1 follow-up — parent link must ship zero <script> tags.
//
// The C-45 parent page (`app/p/[token]/page.tsx`) is meant to be safe to
// open on a stranger's device: no client hydration, no analytics, no
// tracking. The original implementation put a "use client" service-worker
// registrar in the root layout, which forced Next.js to ship the client
// runtime (webpack, framework, main-app, layout chunks) to every page
// that inherited the root layout — including /p/[token]. In production
// that meant 10–13 <script> tags on the page; the C-45 "zero
// JavaScript" claim was false, and the previous "passing e2e test"
// (scripts/e2e-parent-link-zero-js.ts) referenced in package.json
// never existed as code — CI never ran it.
//
// This test exists so that gap cannot recur. It builds the app,
// starts `next start` on an isolated port, fetches /p/[token] (valid +
// invalid) with curl, and counts <script> tags in the raw response
// body. Dev mode is not consulted: the property the user cares about
// is the shipped artifact, not the developer's local experience.
//
// The valid token is signed in-process using the same PARENT_LINK_SECRET
// the seed/.env sets; if it is missing, the test falls back to the dev
// secret (lib/services/parent-link.ts does the same). It needs a real
// (tenant_id, member_id) pair, fetched from the DB after `pnpm seed`.
//
// Run: pnpm e2e:parent-link-zero-js
//
// The script takes ~30–60 s on a warm machine (Next.js production build
// dominates). It cleans up its dev server on every exit path.

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { createHmac, randomUUID } from "node:crypto";
import { Pool } from "pg";

// Minimal .env loader so this script can be invoked directly via
// `tsx` (which does not auto-load Next.js env files). We only need
// DATABASE_URL, MIGRATION_DATABASE_URL, and PARENT_LINK_SECRET — the
// three vars this test reads. We deliberately do NOT pull in
// `dotenv` (or Next's loadEnvConfig) to keep the script's blast
// radius small.
(function loadDotEnv() {
  const path = resolve(process.cwd(), ".env");
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
})();

const PORT = 3221;
const BASE = `http://127.0.0.1:${PORT}`;

function b64url(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function fetchBody(path: string): Promise<{ status: number; body: string }> {
  const res = await fetch(`${BASE}${path}`);
  return { status: res.status, body: await res.text() };
}

function countScriptTags(html: string): number {
  // Count literal `<script` occurrences (handles self-closing, src=,
  // inline, and the `<script>` opening tag in any case Next emits).
  const matches = html.match(/<script\b/gi);
  return matches?.length ?? 0;
}

async function seedSigningMaterial(): Promise<{ tenantId: string; memberId: string }> {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) {
    throw new Error(
      "MIGRATION_DATABASE_URL is required to derive a valid token. " +
        "Run pnpm db:reset && pnpm seed first.",
    );
  }
  const admin = new Pool({ connectionString: url });
  try {
    const r = await admin.query<{ tenant_id: string; member_id: string }>(
      `select m.tenant_id::text as tenant_id, m.id::text as member_id
         from members m
         join persons p on p.id = m.person_id
        where p.full_name = 'Aarav Sharma'
        limit 1`,
    );
    if (r.rows.length === 0) {
      throw new Error(
        "Aarav Sharma (AWS-001) not found — run pnpm db:reset && pnpm seed first.",
      );
    }
    return { tenantId: r.rows[0].tenant_id, memberId: r.rows[0].member_id };
  } finally {
    await admin.end();
  }
}

function signToken(args: {
  tenantId: string;
  memberId: string;
  secret: string;
}): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const iat = Math.floor(Date.now() / 1000);
  const exp = iat + 7 * 24 * 3600;
  // The verifier reads `personId` as the member id (see
  // app/p/[token]/page.tsx + lib/services/parent-view.ts).
  const payload = b64url(
    JSON.stringify({
      tenantId: args.tenantId,
      personId: args.memberId,
      scope: "parent_view",
      iat,
      exp,
      jti: `${iat}-${randomUUID()}`,
    }),
  );
  const sig = b64url(
    createHmac("sha256", args.secret).update(`${header}.${payload}`).digest(),
  );
  return `${header}.${payload}.${sig}`;
}

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${BASE}/login`, { redirect: "manual" });
      // next start returns 200 or 307 for /login depending on auth state;
      // any TCP-level response means the server is up.
      void res;
      return;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error(`dev server never came up on ${BASE}`);
}

async function main(): Promise<void> {
  // Build to the default `.next/` directory. The test starts a
  // production server on an isolated port (3221) so it does not
  // collide with a developer's running `next dev` on 3000/3211/etc.
  console.log(`building production bundle…`);
  // Build with NODE_ENV=production to mirror what CI does. The
  // .env file ships NODE_ENV=development (a local-dev convenience),
  // but a production build needs the real thing or the prerender
  // step runs with mismatched assumptions and emits "<Html> should
  // not be imported outside of pages/_document" on /404.
  execFileSync("pnpm", ["next", "build"], {
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "production" },
  });

  // PARENT_LINK_SECRET must match what lib/services/parent-link.ts
  // reads. The dev fallback in that module derives from DATABASE_URL,
  // so we pin a known secret here for a deterministic signature.
  const secret =
    process.env.PARENT_LINK_SECRET ??
    "test-parent-link-secret-abcdefghijklmnopqrstuvwxyz";

  let server: ChildProcess | null = null;
  try {
    console.log(`starting next start on ${BASE}…`);
    server = spawn("pnpm", ["next", "start", "-p", String(PORT)], {
      stdio: "ignore",
      detached: true,
      env: { ...process.env, PARENT_LINK_SECRET: secret },
    });
    await waitForServer();

    // 1) Invalid token: the page renders the generic "link expired"
    //    early-return path. Even though it doesn't reach the data
    //    fetch, it must still ship zero <script> tags — the root
    //    layout used to be the leak.
    const invalid = await fetchBody("/p/totally-not-a-real-token");
    const invalidCount = countScriptTags(invalid.body);
    if (invalid.status !== 200 || invalidCount !== 0) {
      throw new Error(
        `invalid-token page failed the property: status=${invalid.status}, <script> count=${invalidCount}, body=${invalid.body.slice(0, 200)}`,
      );
    }

    // 2) Valid token: the page renders the member's data. The RSC
    //    payload for the rendered data is server-streamed HTML; it
    //    must not be accompanied by any client runtime.
    const { tenantId, memberId } = await seedSigningMaterial();
    const token = signToken({ tenantId, memberId, secret });
    const valid = await fetchBody(`/p/${token}`);
    const validCount = countScriptTags(valid.body);
    if (valid.status !== 200 || validCount !== 0) {
      throw new Error(
        `valid-token page failed the property: status=${valid.status}, <script> count=${validCount}, body=${valid.body.slice(0, 400)}`,
      );
    }

    // 3) Sanity: the page must still contain the child's name. If
    //    the token's claims are right and the data path renders, the
    //    assertion above is a real coverage of the surface, not an
    //    assertion on a stub.
    if (!valid.body.includes("Aarav Sharma")) {
      throw new Error(
        `valid-token page did not contain the seeded member's name — the page is rendering a stub.`,
      );
    }

    console.log(
      `✓ parent link ships zero <script> tags in production build (invalid + valid tokens, both 0).`,
    );
  } finally {
    if (server?.pid) {
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch {
        // best effort
      }
    }
    await sleep(500);
  }
}

main().catch((err) => {
  console.error("e2e:parent-link-zero-js FAILED:", err);
  process.exit(1);
});
