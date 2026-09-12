// PR D1 — role-bypass attack e2e (rework after auditor's findings).
//
// Background (the auditor's three findings, restated):
//
//   1. GET /owner, /owner/members, /owner/members/[memberId] with
//      RSC: 1 and a Next-Router-State-Tree header claiming the
//      (owner) segment is already mounted → HTTP 200 with the
//      dashboard figures, the full member roster, and a member's
//      dateOfBirth. Next.js skips the layout when the client-supplied
//      router state tree says the segment is mounted, so the
//      layout's canAccessSurface check never runs.
//
//   2. POST with a Next-Action header pointing at
//      getOwnerDashboardAction's hash (from
//      .next/server/server-reference-manifest.json) → HTTP 200,
//      full payload. The action's body is encodeReply([])
//      (the action takes no arguments) — confirmed by sniffing
//      react-server-dom-webpack's encodeReply output for an empty
//      args array.
//
//   3. POST with a Next-Action against listMembersAction and
//      getMemberDetailAction. Both require members.read, which
//      coaches legitimately hold for their own roster — the check
//      is per-role-grant not per-row, so a coach's POST reaches the
//      tenant's full member list.
//
// The auditor also found four bugs in v1 of this test:
//   - Every Next-Action POST returned 500 E{digest} because v1
//     sent no body. encodeReply([]) is "[]" — the literal bytes
//     `[]` — not nothing.
//   - The /owner/members/[memberId] case silently dropped on a
//     "[warn] could not resolve a member id" — bootstrap failures
//     became warnings, not test failures.
//   - v1 hardcoded routerStateTree(["(owner)"]) for every shape,
//     so attacks on /coach and /reception always bypassed
//     harmlessly.
//   - v1 only checked status codes. A plain GET by a coach to
//     /owner/members returns a 404 whose HTML body contains the
//     full member roster in the streamed RSC payload
//     (self.__next_f.push(...)). Status codes are not evidence.
//
// What this rework fixes:
//   (a) Testcontainer Postgres, never aqua-db. The shared local
//       Postgres was contaminated with stale state from prior
//       sessions and is the same DB the demo seed uses. The
//       rework spins a fresh container per run.
//   (b) Body encoding: encodeReply([]) for no-arg actions, the
//       exact bytes Next.js's client bundle produces.
//   (c) Per-route-group router state tree: a coach attacking
//       /coach uses a tree claiming "(coach)" is mounted; the
//       same for /reception.
//   (d) Body assertions on every shape, including streamed RSC
//       payloads in 404 responses.
//   (e) Positive control per route and per shape, failures
//       reported as "harness broken" and fail the run separately
//       from real-leak failures.
//   (f) No skips. Every bootstrap step throws on failure.
//   (g) The number of attack cases actually executed is asserted
//       against an expected minimum, so silently dropped cases fail
//       the run.
//
// Lives outside tests/tier1/ per the agent workflow rule (docs/
// agent-setup.md). The script cannot edit tests/tier1/ directly;
// it does require the no-superuser allowlist to cover scripts/
// — that entry already exists.
//
// Run: pnpm e2e:role-bypass

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createRequire } from "node:module";
import { Pool } from "pg";
import {
  PostgreSqlContainer,
} from "@testcontainers/postgresql";
import { bootstrapRoles } from "@/db/bootstrap-roles";
import { runMigrations } from "@/db/migrate";
// The encodeReply function is the same one Next.js's bundled
// react-server-dom-webpack client uses; importing from the bundled
// path keeps the body bytes byte-identical to what a real browser
// POSTs. The module has no .d.ts — `createRequire` is used to
// load it from CJS without top-level await. encodeReply returns a
// STRING (the wire format is text), not a Uint8Array — verified
// at runtime below.
const require = createRequire(import.meta.url);
const { encodeReply, createTemporaryReferenceSet } = require(
  "next/dist/compiled/react-server-dom-webpack/cjs/react-server-dom-webpack-client.node.unbundled.production.js",
) as {
  encodeReply: (value: unknown, options: { temporaryReferences: Map<string, unknown> }) => Promise<string>;
  createTemporaryReferenceSet: () => Map<string, unknown>;
};

// ----- ports -----
const PORT = 3220;
const BASE = `http://127.0.0.1:${PORT}`;

async function assertPortFree(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(
          `port ${port} is already in use — a previous e2e run likely ` +
          `left a stale next start. Find and kill it (lsof -i :${port} or ` +
          `fuser -k ${port}/tcp), then re-run.`,
        ));
      } else {
        reject(err);
      }
    });
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve()));
  });
}

// ----- Testcontainer -----
async function startIsolatedDb() {
  const container = await new PostgreSqlContainer("postgres:16").start();
  const adminUri = container.getConnectionUri();
  const appPassword = "isolated-test-pw";
  await bootstrapRoles(adminUri, appPassword);
  await runMigrations(adminUri);
  const host = container.getHost();
  const port = container.getPort();
  const database = container.getDatabase();
  const appUri = `postgresql://app_login:${encodeURIComponent(appPassword)}@${host}:${port}/${database}`;
  const admin = new Pool({ connectionString: adminUri });
  return { container, admin, adminUri, appUri, stop: async () => {
    await admin.end();
    await container.stop();
  } };
}

// ----- build & start -----
async function buildAndStart(env: NodeJS.ProcessEnv): Promise<ChildProcess> {
  console.log("building production bundle…");
  execFileSync("pnpm", ["next", "build"], {
    stdio: "inherit",
    env: { ...env, NODE_ENV: "production" },
  });
  console.log(`starting next start on ${BASE}…`);
  const server = spawn("pnpm", ["next", "start", "-p", String(PORT)], {
    stdio: "ignore",
    detached: true,
    env,
  });
  for (let i = 0; i < 180; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return server;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`next start never came up on ${BASE}`);
}

// ----- seeded users (mirror scripts/seed.ts:LOGIN_USERS) -----
// Each role's phone and the role it maps to per lib/auth/surface-access.ts.
// Owner + admin + accountant + receptionist + coach + worker + parent are
// seeded by scripts/seed.ts; we test the cross-surface attack for the
// three roles that have a real UI surface.
type Role = "owner" | "coach" | "receptionist";

// ----- better-auth OTP login -----
async function readOtp(adminUri: string, phone: string): Promise<string> {
  const admin = new Pool({ connectionString: adminUri });
  try {
    const r = await admin.query<{ value: string }>(
      `select value from ba_verification where identifier = $1 order by created_at desc limit 1`,
      [phone],
    );
    const raw = r.rows[0]?.value;
    if (!raw) throw new Error(`no OTP for ${phone} — ba_verification is empty`);
    return raw.split(":")[0]!;
  } finally {
    await admin.end();
  }
}

async function loginAs(adminUri: string, phone: string): Promise<string> {
  const send = await fetch(`${BASE}/api/auth/phone-number/send-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  });
  if (!send.ok) throw new Error(`send-otp failed: ${send.status} ${await send.text()}`);
  const otp = await readOtp(adminUri, phone);
  const verify = await fetch(`${BASE}/api/auth/phone-number/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: otp }),
    redirect: "manual",
  });
  const setCookie = verify.headers.get("set-cookie");
  if (!setCookie) throw new Error(`verify-otp failed: ${verify.status} ${await verify.text()}`);
  const match = setCookie.match(/(better-auth\.session_token=[^;]+)/);
  if (!match) throw new Error(`no better-auth.session_token: ${setCookie}`);
  return match[1]!;
}

// ----- router-state-tree builder -----
// Build the tree for the route group actually being attacked. A coach
// attacking /owner uses "(owner)" in the tree; attacking /coach uses
// "(coach)"; attacking /reception uses "(reception)". The auditor's
// v1 always sent "(owner)", which masked the bypass against /coach and
// /reception (Next.js skips the layout when the route group in the
// tree matches the layout's segment — a tree with "(coach)" is
// required to skip the /coach layout, not just any tree).
function routerStateTree(segments: string[]): string {
  // Build [segment, { children: [...nested...] }] bottom-up. The
  // shape mirrors what prepareFlightRouterStateForRequest accepts
  // (string segment, parallelRoutes.children with the next tuple).
  let tree: unknown[] = ["", { children: ["__PAGE__", {}] }];
  for (const seg of segments) {
    tree = [seg, { children: tree }];
  }
  return encodeURIComponent(JSON.stringify(tree));
}

// ----- request shape executor -----
type Shape = "plain" | "rsc" | "action";

interface Attack {
  // What this case is. Recorded in failures and the case-count
  // assert at the end so silently dropped cases can't make the
  // suite pass.
  readonly caseName: string;
  // Shape to replay.
  readonly shape: Shape;
  // Path to hit. For shape="action" this is the page that owns
  // the action (so the server can resolve the action hash).
  readonly path: string;
  // For shape="action" only: the action hash + its args.
  readonly actionId?: string;
  readonly actionArgs?: unknown[];
  // For shape="rsc" only: which route group to claim as mounted.
  // Must be the SAME group as the route's layout, otherwise
  // Next.js correctly refuses the bypass.
  readonly routeGroup?: string;
}

async function fetchShape(opts: {
  cookie: string;
  attack: Attack;
  method?: string;
  body?: BodyInit;
}): Promise<{ status: number; body: string; contentType: string }> {
  const headers: Record<string, string> = { Cookie: opts.cookie };
  let method = opts.method ?? "GET";
  if (opts.attack.shape === "rsc") {
    headers["RSC"] = "1";
    headers["Next-Router-State-Tree"] = routerStateTree([
      `(${opts.attack.routeGroup})`,
    ]);
    headers["Accept"] = "text/x-component";
  } else if (opts.attack.shape === "action") {
    method = "POST";
    headers["Next-Action"] = opts.attack.actionId ?? "";
    headers["Accept"] = "text/x-component";
    headers["Content-Type"] = "text/plain;charset=UTF-8";
    // Body must be encodeReply(args) — the literal bytes Next.js's
    // client bundle produces. Empty args → "[]"; no-arg actions
    // (getOwnerDashboardAction, listStaffAction) use this.
    // listMembersAction takes a filter object — for the attack we
    // send empty object so it returns ALL members regardless of
    // role, the bypass case.
    const args = opts.attack.actionArgs ?? [];
    const temp = createTemporaryReferenceSet();
    const bodyStr = await encodeReply(args, { temporaryReferences: temp });
    // encodeReply returns a string (the wire format). Pass the
    // string body to fetch — undici auto-derives Content-Length
    // from the string length when the body is a string. Setting
    // Content-Length manually trips undici's "duplicate
    // content-length header" check (the constructor adds it from
    // the string before the explicit header is read).
    opts.body = bodyStr as unknown as BodyInit;
  }
  const res = await fetch(`${BASE}${opts.attack.path}`, {
    method,
    headers,
    body: opts.body,
    redirect: "manual",
  });
  return {
    status: res.status,
    body: await res.text(),
    contentType: res.headers.get("content-type") ?? "",
  };
}

// ----- action hashes from the production manifest -----
type Manifest = Record<string, {
  exportedName: string;
  filename: string;
}>;
function readManifest(): Manifest {
  const text = readFileSync(
    resolve(process.cwd(), ".next/server/server-reference-manifest.json"),
    "utf8",
  );
  const json = JSON.parse(text) as {
    node: Record<string, { filename: string; exportedName: string }>;
  };
  const out: Manifest = {};
  for (const [hash, entry] of Object.entries(json.node ?? {})) {
    out[hash] = { filename: entry.filename, exportedName: entry.exportedName };
  }
  return out;
}
function findActionHash(
  manifest: Manifest,
  filename: string,
  exportedName: string,
): string | undefined {
  for (const [hash, entry] of Object.entries(manifest)) {
    if (entry.filename.endsWith(filename) && entry.exportedName === exportedName) {
      return hash;
    }
  }
  return undefined;
}

// ----- protected-data assertions -----
// The auditor's exact payload shape: any of these strings in the
// response body is a leak. We check the raw HTTP body — which
// includes the streamed RSC payload even when status is 404 —
// because the layout-bypass case streams the page's data in the
// self.__next_f.push(...) payload regardless of status.
const PROTECTED_STRINGS = [
  // Tenant identity — every seeded fixture gets the same
  // demo-academy tenant with this name. The owner home page
  // renders it in the <h1> via branding.displayName ?? data.tenantName.
  "Demo Academy",
  // dashboard figure fields (getOwnerDashboardAction).
  "tenantName",
  "activeMemberCount",
  "todayMarked",
  "attendanceThisWeekPct",
  "todaysLanes",
  "needsAttention",
  // seeded member names — appear in /owner/members and the
  // member detail page RSC payload even when the layout gate is
  // bypassed.
  "Synthetic Member",
  // member detail fields — dateOfBirth is the explicit
  // auditor-named check for /owner/members/[id].
  "dateOfBirth",
  "medicalNotes",
];
function leaksProtected(body: string): string | null {
  for (const s of PROTECTED_STRINGS) {
    if (body.includes(s)) return s;
  }
  return null;
}

// ----- attack surface -----
// Map of role → entitled surface. Cross-surface access is the
// bypass. Within-surface pages on the entitled surface are the
// positive control. SURFACE / SURFACE_GROUP are kept as data so the
// route group ↔ surface path mapping is explicit; the test cases
// reference SURFACE_GROUP directly via attack.routeGroup.
const SURFACE: Record<Role, string> = {
  owner: "/owner",
  coach: "/coach",
  receptionist: "/reception",
};
void SURFACE; // pinned for the prose; cases reference it indirectly
const SURFACE_GROUP: Record<Role, "owner" | "coach" | "reception"> = {
  owner: "owner",
  coach: "coach",
  receptionist: "reception",
};
void SURFACE_GROUP; // same — pinned for the prose above

interface TestCase {
  readonly id: string;
  readonly role: Role;
  readonly attack: Attack;
}

// Every attack case the auditor found, named explicitly. Per (e).
// "silently dropped cases fail" means every TestCase below is
// sent over the wire; the testCount assert at the end verifies
// nothing was skipped.
const TEST_CASES: TestCase[] = [
  // Vector 1 — coach attacking owner pages.
  {
    id: "coach→/owner (plain GET)",
    role: "coach",
    attack: { caseName: "plain", shape: "plain", path: "/owner", routeGroup: "owner" },
  },
  {
    id: "coach→/owner (RSC + tree claiming (owner))",
    role: "coach",
    attack: { caseName: "rsc", shape: "rsc", path: "/owner", routeGroup: "owner" },
  },
  {
    id: "coach→/owner/members (plain GET — auditor's body-leak case)",
    role: "coach",
    attack: { caseName: "plain", shape: "plain", path: "/owner/members", routeGroup: "owner" },
  },
  {
    id: "coach→/owner/members (RSC + tree)",
    role: "coach",
    attack: { caseName: "rsc", shape: "rsc", path: "/owner/members", routeGroup: "owner" },
  },
  {
    id: "coach→/owner/members/[id] (RSC + tree, dateOfBirth case)",
    role: "coach",
    attack: { caseName: "rsc", shape: "rsc", path: "__MEMBER_ID__", routeGroup: "owner" },
  },

  // Vector 2 — coach → getOwnerDashboardAction (no-arg, encodeReply([])).
  {
    id: "coach→getOwnerDashboardAction (Next-Action, [] args)",
    role: "coach",
    attack: { caseName: "action", shape: "action", path: "/owner", routeGroup: "owner", actionId: "__GET_OWNER_DASH__", actionArgs: [] },
  },

  // Vector 3 — coach → listMembersAction / getMemberDetailAction.
  {
    id: "coach→listMembersAction (Next-Action, no-arg bypass via empty filter)",
    role: "coach",
    attack: { caseName: "action-list", shape: "action", path: "/owner/members", routeGroup: "owner", actionId: "__LIST_MEMBERS__", actionArgs: [] },
  },
  {
    id: "coach→getMemberDetailAction (Next-Action, no-arg bypass via empty id)",
    role: "coach",
    attack: { caseName: "action-detail", shape: "action", path: "/owner/members", routeGroup: "owner", actionId: "__GET_MEMBER_DETAIL__", actionArgs: [""] },
  },

  // Vector 4 — receptionist attacking owner pages.
  {
    id: "receptionist→/owner (plain GET)",
    role: "receptionist",
    attack: { caseName: "plain", shape: "plain", path: "/owner", routeGroup: "owner" },
  },
  {
    id: "receptionist→/owner (RSC + tree)",
    role: "receptionist",
    attack: { caseName: "rsc", shape: "rsc", path: "/owner", routeGroup: "owner" },
  },
  {
    id: "receptionist→getOwnerDashboardAction (Next-Action)",
    role: "receptionist",
    attack: { caseName: "action", shape: "action", path: "/owner", routeGroup: "owner", actionId: "__GET_OWNER_DASH__", actionArgs: [] },
  },
  {
    id: "receptionist→listMembersAction (Next-Action)",
    role: "receptionist",
    attack: { caseName: "action-list", shape: "action", path: "/owner/members", routeGroup: "owner", actionId: "__LIST_MEMBERS__", actionArgs: [] },
  },

  // Vector 5 — receptionist attacking coach pages (the layout-bypass
  // works on /coach too; coach's surface-access allows coach only).
  {
    id: "receptionist→/coach (plain GET)",
    role: "receptionist",
    attack: { caseName: "plain", shape: "plain", path: "/coach", routeGroup: "coach" },
  },
  {
    id: "receptionist→/coach (RSC + tree claiming (coach))",
    role: "receptionist",
    attack: { caseName: "rsc", shape: "rsc", path: "/coach", routeGroup: "coach" },
  },

  // Vector 6 — coach attacking reception pages (the symmetric case).
  {
    id: "coach→/reception (plain GET)",
    role: "coach",
    attack: { caseName: "plain", shape: "plain", path: "/reception", routeGroup: "reception" },
  },
  {
    id: "coach→/reception (RSC + tree claiming (reception))",
    role: "coach",
    attack: { caseName: "rsc", shape: "rsc", path: "/reception", routeGroup: "reception" },
  },
];

// ----- positive controls: entitled role receives the data -----
// Per (d). Each control picks the page the role is entitled to
// (per lib/auth/surface-access.ts) and verifies the page renders
// something specific to that role. If a control fails, that's a
// "harness broken" failure — the test shape is malformed, not the
// application. Reported separately from real-leak failures so a
// reviewer can tell at a glance whether the test caught a real bug
// or just can't run.
//
// Each control asserts two things:
//   1. The status is 200 (the request shape worked — the page
//      authenticated and rendered for the entitled role).
//   2. The body contains something only the tenant's own data
//      produces — a string the server only emits when the tenant's
//      data is in the response. We use "Demo Academy" (the seeded
//      tenant name) and "Morning Squad" (the seeded batch name)
//      because the seed script creates them in scripts/seed.ts:
//      both appear in every tenant-path page's render output
//      (Demo Academy in the tenant-name h1; Morning Squad in the
//      batch-name display).
//
// The control fails (harness broken) when either:
//   - status != 200, OR
//   - body has neither "Demo Academy" nor "Morning Squad".
//
// Either means the request shape is wrong — the entitled role
// doesn't reach the page, so the attack can't reach it either
// (and the attack's "no leak" result would be a false negative).
// Report it separately so a reviewer can distinguish a real
// positive-control failure from a missing-data assertion bug.
const POSITIVE_PROTECTED_TOKENS = ["Demo Academy", "Morning Squad", "Synthetic Member"];
function looksLikeRenderedPage(body: string): boolean {
  return POSITIVE_PROTECTED_TOKENS.some((tok) => body.includes(tok));
}
// The seeded batches run Mon–Sat, so on a Sunday the receptionist's
// Today page is a legitimate authorized empty state with no seeded
// token in it. The empty-state marker still proves the request shape
// reached an authorized render (an unauthenticated request redirects,
// a wrong role 404s), so reception controls may accept it. Both
// serialisations are checked: HTML attribute form for plain GETs and
// the JSON tree form for RSC payloads.
const AUTHORIZED_EMPTY_MARKERS = [
  'data-testid="empty-state"',
  '"data-testid":"empty-state"',
];
const POSITIVE_CONTROLS: {
  id: string;
  role: Role;
  attack: Attack;
  allowEmpty?: boolean;
}[] = [
  // Owner → /owner pages.
  { id: "owner→/owner (plain)", role: "owner", attack: { caseName: "plain", shape: "plain", path: "/owner", routeGroup: "owner" } },
  { id: "owner→/owner (RSC)", role: "owner", attack: { caseName: "rsc", shape: "rsc", path: "/owner", routeGroup: "owner" } },
  { id: "owner→/owner (action)", role: "owner", attack: { caseName: "action", shape: "action", path: "/owner", routeGroup: "owner", actionId: "__GET_OWNER_DASH__", actionArgs: [] } },
  { id: "owner→/owner/members (plain)", role: "owner", attack: { caseName: "plain", shape: "plain", path: "/owner/members", routeGroup: "owner" } },
  { id: "owner→/owner/members (RSC)", role: "owner", attack: { caseName: "rsc", shape: "rsc", path: "/owner/members", routeGroup: "owner" } },
  // Coach → /coach pages.
  { id: "coach→/coach (plain)", role: "coach", attack: { caseName: "plain", shape: "plain", path: "/coach", routeGroup: "coach" } },
  { id: "coach→/coach (RSC)", role: "coach", attack: { caseName: "rsc", shape: "rsc", path: "/coach", routeGroup: "coach" } },
  // Receptionist → /reception pages.
  { id: "receptionist→/reception (plain)", role: "receptionist", allowEmpty: true, attack: { caseName: "plain", shape: "plain", path: "/reception", routeGroup: "reception" } },
  { id: "receptionist→/reception (RSC)", role: "receptionist", allowEmpty: true, attack: { caseName: "rsc", shape: "rsc", path: "/reception", routeGroup: "reception" } },
];

interface Outcome {
  readonly caseName: string;
  readonly role: Role;
  readonly shape: Shape;
  readonly status: number;
  readonly contentType: string;
  readonly leaked: string | null;
  readonly bodyBytes: number;
}

async function main(): Promise<void> {
  await assertPortFree(PORT);

  // --- start isolated DB (Testcontainer, never aqua-db) ---
  const iso = await startIsolatedDb();
  const failures: Outcome[] = [];
  const controlFailures: Outcome[] = [];
  let casesRun = 0;
  let server: ChildProcess | null = null;

  try {
    // --- point env at the Testcontainer DB for everything that
    //     builds + starts next + runs the seed ---
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "production",
      DATABASE_URL: iso.appUri,
      MIGRATION_DATABASE_URL: iso.adminUri,
      APP_LOGIN_PASSWORD: "isolated-test-pw",
    };
    // The seed script uses the env vars; run it against the
    // Testcontainer DB.
    console.log("seeding Testcontainer DB…");
    execFileSync("pnpm", ["tsx", "scripts/seed.ts"], {
      stdio: "inherit",
      env,
    });

    // --- resolve a real member id for the /owner/members/[id] case ---
    const adminForLookup = new Pool({ connectionString: iso.adminUri });
    const memberRow = await adminForLookup.query<{ id: string }>(
      `select m.id::text as id from members m
         join tenants t on t.id = m.tenant_id
         where t.slug = 'demo-academy'
         order by m.member_code asc limit 1`,
    );
    await adminForLookup.end();
    if (!memberRow.rows[0]?.id) throw new Error("seed did not produce any members");
    const memberId = memberRow.rows[0]!.id;

    // --- resolve action hashes from the production manifest ---
    server = await buildAndStart(env);
    const manifest = readManifest();
    const actionHashes = {
      getOwnerDashboardAction: findActionHash(manifest, "lib/actions/dashboard.ts", "getOwnerDashboardAction"),
      listMembersAction: findActionHash(manifest, "lib/actions/people.ts", "listMembersAction"),
      getMemberDetailAction: findActionHash(manifest, "lib/actions/people.ts", "getMemberDetailAction"),
    };
    for (const [name, hash] of Object.entries(actionHashes)) {
      if (!hash) throw new Error(`action ${name} not in manifest`);
    }

    // Substitute the placeholders in TEST_CASES + POSITIVE_CONTROLS
    // with the resolved hashes + member id.
    function resolve(attack: Attack): Attack {
      const out = { ...attack };
      if (out.path === "__MEMBER_ID__") out.path = `/owner/members/${memberId}`;
      if (out.actionId === "__GET_OWNER_DASH__") out.actionId = actionHashes.getOwnerDashboardAction!;
      if (out.actionId === "__LIST_MEMBERS__") out.actionId = actionHashes.listMembersAction!;
      if (out.actionId === "__GET_MEMBER_DETAIL__") out.actionId = actionHashes.getMemberDetailAction!;
      return out;
    }

    // --- login each role ---
    const cookies: Record<Role, string> = {
      owner: await loginAs(iso.adminUri, "+919000000001"),
      coach: await loginAs(iso.adminUri, "+919000000002"),
      receptionist: await loginAs(iso.adminUri, "+919000000005"),
    };

    // --- positive controls first ---
    console.log("\n[positive controls]");
    for (const ctrl of POSITIVE_CONTROLS) {
      const attack = resolve(ctrl.attack);
      const res = await fetchShape({ cookie: cookies[ctrl.role], attack });
      casesRun++;
      // Per (d): positive control passes iff the entitled role
      // gets the page (200) AND the body contains something the
      // server only emits for a real tenant render (not an error
      // page or 404). A negative control here means the request
      // shape is broken — every attack assertion downstream is
      // unreliable, so report it as a separate "harness broken"
      // failure.
      const rendered =
        res.status === 200 &&
        (looksLikeRenderedPage(res.body) ||
          (ctrl.allowEmpty === true &&
            AUTHORIZED_EMPTY_MARKERS.some((m) => res.body.includes(m))));
      if (!rendered) {
        controlFailures.push({
          caseName: ctrl.id,
          role: ctrl.role,
          shape: attack.shape,
          status: res.status,
          contentType: res.contentType,
          leaked: null,
          bodyBytes: res.body.length,
        });
        const snippet = res.body.length > 500
          ? res.body.slice(0, 200) + "..." + res.body.slice(-1500)
          : res.body.slice(0, 500);
        console.log(`  [harness-broken] ${ctrl.id} — status=${res.status} ct=${res.contentType}, body ${res.body.length} bytes; expected 200 with rendered tenant data`);
        console.log(`    body: ${snippet}`);
      } else {
        console.log(`  [✓] ${ctrl.id} — status=200, rendered`);
      }
    }

    // --- attacks ---
    console.log("\n[attacks]");
    for (const tc of TEST_CASES) {
      const attack = resolve(tc.attack);
      const res = await fetchShape({ cookie: cookies[tc.role], attack });
      casesRun++;
      const leaked = leaksProtected(res.body);
      if (leaked) {
        failures.push({
          caseName: tc.id,
          role: tc.role,
          shape: attack.shape,
          status: res.status,
          contentType: res.contentType,
          leaked,
          bodyBytes: res.body.length,
        });
        console.log(`  [LEAK] ${tc.id} — "${leaked}" in body (status=${res.status} ct=${res.contentType})`);
      } else {
        console.log(`  [✓] ${tc.id} — no protected string in body (status=${res.status} ct=${res.contentType})`);
      }
    }
  } finally {
    if (server?.pid) {
      try { process.kill(-server.pid, "SIGTERM"); } catch {}
    }
    await new Promise((r) => setTimeout(r, 500));
    await iso.stop();
  }

  console.log(`\n[summary] cases run: ${casesRun}`);

  // Per (a) + (f): silently dropped cases must fail. The expected
  // minimum is the number of attack + control cases — counted from
  // the source-of-truth arrays above so a future contributor who
  // adds a case but forgets to wire it up fails this assertion.
  const expectedCases = TEST_CASES.length + POSITIVE_CONTROLS.length;
  if (casesRun < expectedCases) {
    console.error(`[✗] only ${casesRun} of ${expectedCases} cases ran — silently dropped cases fail`);
    process.exit(1);
  }

  if (controlFailures.length > 0) {
    console.error(`[✗] ${controlFailures.length} positive control(s) FAILED — harness broken, separate from real leaks:`);
    for (const f of controlFailures) {
      console.error(`    - [${f.caseName}] expected protected data; got status=${f.status} ct=${f.contentType}`);
    }
  }

  if (failures.length > 0) {
    console.error(`[✗] ${failures.length} leak(s) found:`);
    for (const f of failures) {
      console.error(`    - [${f.caseName}] leaked "${f.leaked}" (${f.bodyBytes} bytes)`);
    }
    process.exit(1);
  }

  if (controlFailures.length > 0) {
    console.error(`[✗] positive controls failed — harness broken; fix the test shape`);
    process.exit(1);
  }

  console.log(`[✓] all ${casesRun} cases passed (${TEST_CASES.length} attacks + ${POSITIVE_CONTROLS.length} controls)`);
  process.exit(0);
}

main().catch((err) => {
  console.error("e2e:role-bypass FAILED:", err);
  process.exit(1);
});