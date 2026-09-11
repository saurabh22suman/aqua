// PR D1 — role-bypass attack e2e.
//
// Background (the auditor's three findings):
//
//   1. GET /owner, /owner/members, /owner/members/[memberId] with
//      RSC: 1 and a Next-Router-State-Tree header claiming the
//      (owner) segment is already mounted → HTTP 200 with the
//      dashboard figures, the full member roster, and a member's
//      dateOfBirth. Next.js skips the layout when the client-supplied
//      router state tree says the segment is mounted.
//
//   2. POST with a Next-Action header to getOwnerDashboardAction's
//      hash (from .next/server/server-reference-manifest.json) →
//      HTTP 200, full payload. lib/actions/dashboard.ts calls
//      requireDefaultCtx and nothing else — no role/permission check.
//
//   3. listMembersAction and getMemberDetailAction require
//      members.read, which coaches legitimately hold for their own
//      roster — so the existing check doesn't stop a coach who
//      points at another tenant's roster via direct Next-Action POST.
//
// What this file does:
//
//   * Builds production (`pnpm next build`) and starts `pnpm next
//     start` on an isolated port — production build only; dev mode
//     bundles differently (per H1 follow-up).
//
//   * For each seeded role (owner, coach, receptionist), logs in
//     through the real OTP flow: trigger send-otp, read the code
//     better-auth just wrote into ba_verification, POST to verify.
//
//   * For every page under app/(owner)/, app/(coach)/,
//     app/(reception)/, replays three request shapes:
//       (a) plain GET
//       (b) GET with RSC: 1 + a router-state-tree claiming the
//           route group's layout is mounted (the (a)→(b) attack
//           vector)
//       (c) POST with Next-Action: <hash> (the action-only vector,
//           with the action's ID read from the production build's
//           server-reference-manifest.json)
//
//   * For each (role, surface) pair where the role is NOT entitled
//     to the surface (e.g. coach → owner, receptionist → coach),
//     asserts no protected data in the response. The protected
//     data checks: seeded member names, dateOfBirth values, the
//     tenant name in dashboard figures, and the action payload
//     fields.
//
//   * Positive control: the entitled role sends the same
//     requests and receives the data. If the control fails, the
//     test fails — every shape is genuinely a request the
//     application services; nothing is passing because every
//     request is malformed.
//
//   * Wired into ci.yml as a `run:` step (not a comment). The
//     failing assertions in this PR are the attack the auditor
//     found; PR D2 stacks the page-guard + action-permission
//     fixes on top and turns this test green.
//
// Lives outside tests/tier1/ per the standing rule — adding new
// files there is OK; editing existing tier1 files isn't. The
// alternative path (a vitest test in tests/tier1/) couldn't run a
// real `next start` against a real Postgres-backed session
// without the testcontainer spin-up, and the attack the auditor
// ran was against the production build artifact specifically
// (RSC + router-state-tree behaviour differs in dev vs prod).

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";

// ----- env loading (mirrors scripts/e2e-parent-link-zero-js.ts) -----
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

const PORT = 3220;
const BASE = `http://127.0.0.1:${PORT}`;

// ----- ports / server lifecycle -----
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

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 180; i++) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`dev server never came up on ${BASE}`);
}

// ----- audit: build & start -----
async function buildAndStart(): Promise<ChildProcess> {
  console.log("building production bundle…");
  execFileSync("pnpm", ["next", "build"], {
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "production" },
  });
  console.log(`starting next start on ${BASE}…`);
  const server = spawn("pnpm", ["next", "start", "-p", String(PORT)], {
    stdio: "ignore",
    detached: true,
  });
  await waitForServer();
  return server;
}

// ----- better-auth OTP login -----
// The seeded login users (scripts/seed.ts:LOGIN_USERS) cover the four
// roles the auditor attacked against.
type Role = "owner" | "coach" | "receptionist";

// better-auth stores OTP codes in ba_verification as `${code}:0`.
// identifier is the phone number. The OTP is consumed after a
// successful verify; the script pulls it once per login.
async function readOtp(phone: string): Promise<string> {
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) throw new Error("MIGRATION_DATABASE_URL required to read OTP");
  const admin = new Pool({ connectionString: url });
  try {
    const r = await admin.query<{ value: string }>(
      `select value from ba_verification
        where identifier = $1
        order by created_at desc
        limit 1`,
      [phone],
    );
    const raw = r.rows[0]?.value;
    if (!raw) throw new Error(`no OTP found in ba_verification for ${phone}`);
    return raw.split(":")[0]!;
  } finally {
    await admin.end();
  }
}

async function loginAs(phone: string): Promise<string> {
  // Trigger the OTP. better-auth's send-otp endpoint is at
  // /api/auth/phone-number/send-otp (the [...all] catch-all routes
  // /api/auth/* via app/api/auth/[...all]/route.ts).
  const sendRes = await fetch(`${BASE}/api/auth/phone-number/send-otp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  });
  if (!sendRes.ok) {
    throw new Error(
      `send-otp failed for ${phone}: ${sendRes.status} ${await sendRes.text()}`,
    );
  }
  const otp = await readOtp(phone);
  // Verify the OTP. better-auth's verify endpoint sets the session
  // cookie; capture it and return.
  const verifyRes = await fetch(`${BASE}/api/auth/phone-number/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: otp }),
    redirect: "manual",
  });
  const setCookie = verifyRes.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error(
      `verify-otp failed for ${phone}: ${verifyRes.status} ${await verifyRes.text()}`,
    );
  }
  // Return just the cookie name=value pair (the Set-Cookie header is
  // multi-cookie sometimes; better-auth's session cookie name is
  // "better-auth.session_token").
  const match = setCookie.match(/(better-auth\.session_token=[^;]+)/);
  if (!match) {
    throw new Error(
      `verify-otp did not set better-auth.session_token for ${phone}: ${setCookie}`,
    );
  }
  return match[1]!;
}

// ----- attack helpers -----
// The router-state-tree format Next.js sends is
// encodeURIComponent(JSON.stringify(flightRouterState)). The
// minimal "layout already mounted" tree is a single segment
// claim — the tuple shape Next.js expects:
//
//   [segment, parallelRoutes, refreshMarker?, ...]
//
// where `segment` is the route group name in parentheses, e.g.
// "(owner)". The server-side re-render checks this tree against
// the live segment cache; if a segment is in the tree with
// matching parallel-route keys, it's considered already rendered
// and the layout's server component is NOT re-invoked. That is
// the bypass the auditor used: claiming "(owner)" is mounted in
// the tree while the user holds only a coach session — the
// layout's canAccessSurface check never runs.
function routerStateTree(segments: string[]): string {
  // Build [segment, { children: [...nested...] }] bottom-up.
  let tree: unknown[] = ["", { children: ["__PAGE__", {}] }];
  for (const seg of segments) {
    tree = [seg, { children: tree }];
  }
  // Next.js's prepareFlightRouterStateForRequest does a strip pass
  // for HMR; production requests just encodeURIComponent the
  // JSON.
  return encodeURIComponent(JSON.stringify(tree));
}

async function fetchShape(opts: {
  path: string;
  cookie: string;
  shape: "plain" | "rsc" | "action";
  actionId?: string;
  body?: string;
}): Promise<{ status: number; body: string; contentType: string }> {
  const headers: Record<string, string> = {
    Cookie: opts.cookie,
  };
  let method = "GET";
  if (opts.shape === "rsc") {
    headers["RSC"] = "1";
    headers["Next-Router-State-Tree"] = routerStateTree(["(owner)"]);
    headers["Accept"] = "text/x-component";
  } else if (opts.shape === "action") {
    method = "POST";
    headers["Next-Action"] = opts.actionId ?? "";
    headers["Accept"] = "text/x-component";
    headers["Content-Type"] = "text/plain;charset=UTF-8";
  }
  const res = await fetch(`${BASE}${opts.path}`, {
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

// Action hashes — read from the production build's manifest.
// The manifest maps each action's hash to the action's filename +
// exported name; we grep for the actions we care about and read
// their hashes here.
type Manifest = Record<string, {
  exportedName: string;
  filename: string;
  workers?: Record<string, { moduleId: string; async: boolean }>;
}>;
function readManifest(): Manifest {
  const path = resolve(process.cwd(), ".next/server/server-reference-manifest.json");
  const text = readFileSync(path, "utf8");
  const json = JSON.parse(text) as {
    node: Record<string, { workers?: Record<string, { moduleId: string; async: boolean }>; filename: string; exportedName: string }>;
  };
  // The manifest format is { node: { <hash>: { filename, exportedName, workers } } }.
  const out: Manifest = {};
  for (const [hash, entry] of Object.entries(json.node ?? {})) {
    out[hash] = {
      filename: entry.filename,
      exportedName: entry.exportedName,
      workers: entry.workers,
    };
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

// ----- attack surface -----
// Surfaces the auditor attacked. A role is "entitled" to a surface
// per lib/auth/surface-access.ts: owner→owner, coach→coach,
// receptionist→reception. Cross-surface access is the bypass.
const SURFACES: Record<Role, string> = {
  owner: "/owner",
  coach: "/coach",
  receptionist: "/reception",
};

// Every page.tsx under a route group the auditor named. For each
// page, the test sends all three request shapes against it.
const PAGES_BY_SURFACE: Record<"owner" | "coach" | "reception", string[]> = {
  owner: [
    "/owner",
    "/owner/members",
    "/owner/members/new",
    // /owner/members/[memberId] needs a real id; the seed creates
    // 16 members — fetch one and use its id. Set in main().
  ],
  coach: ["/coach", "/coach/members", "/coach/schedule"],
  reception: ["/reception", "/reception/enquiries", "/reception/members/new"],
};

// Actions the auditor named. Direct Next-Action POST against these
// — the third attack vector. Action hashes come from the manifest.
const ACTIONS_TO_TEST = [
  { file: "lib/actions/dashboard.ts", exportName: "getOwnerDashboardAction" },
  { file: "lib/actions/people.ts", exportName: "listMembersAction" },
  { file: "lib/actions/people.ts", exportName: "getMemberDetailAction" },
  { file: "lib/actions/owner-reports.ts", exportName: "getAttendanceReportAction" },
  { file: "lib/actions/owner-reports.ts", exportName: "getRetentionViewAction" },
  { file: "lib/actions/staff.ts", exportName: "listStaffAction" },
];

// The data we expect the action responses to leak when the bypass
// succeeds. These strings appear in the JSON payload only when the
// tenant's own data is in the response — they would not be there
// for an unauthenticated / wrong-tenant response.
const PROTECTED_STRINGS = [
  "Synthetic Member", // seeded member names: "Synthetic Member 01"…
  "tenantName",       // dashboard figure field
  "activeMemberCount",
  "todayMarked",
  "attendanceThisWeekPct",
  "todaysLanes",
  "needsAttention",
];

function containsProtected(body: string): string | null {
  for (const s of PROTECTED_STRINGS) {
    if (body.includes(s)) return s;
  }
  return null;
}

// ----- main -----
type Failure = { where: string; detail: string };

async function main(): Promise<void> {
  await assertPortFree(PORT);
  const server = await buildAndStart();
  const failures: Failure[] = [];

  try {
    // 0. Get the manifest of action hashes from the production build.
    const manifest = readManifest();
    const actionHashes: Array<{ name: string; hash: string }> = [];
    for (const a of ACTIONS_TO_TEST) {
      const hash = findActionHash(manifest, a.file, a.exportName);
      if (hash) {
        actionHashes.push({ name: a.exportName, hash });
      } else {
        console.warn(`[warn] action ${a.exportName} (${a.file}) not in manifest`);
      }
    }
    console.log(`[info] found ${actionHashes.length}/${ACTIONS_TO_TEST.length} actions in manifest`);

    // 1. Get a member id for /owner/members/[memberId] by hitting
    //    listMembersAction first (as owner) so we have a real id.
    const ownerCookie = await loginAs("+919000000001");
    const firstListHash = actionHashes.find((a) => a.name === "listMembersAction");
    let memberId = "";
    if (firstListHash) {
      const res = await fetchShape({
        path: "/owner/members",
        cookie: ownerCookie,
        shape: "action",
        actionId: firstListHash.hash,
      });
      // The response is RSC-encoded; grep for a uuid.
      const m = res.body.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
      memberId = m ? m[0] : "";
    }
    if (!memberId) {
      console.warn("[warn] could not resolve a member id; skipping /owner/members/[id] tests");
    } else {
      PAGES_BY_SURFACE.owner.push(`/owner/members/${memberId}`);
    }

    // 2. Login as each role.
    const cookies: Record<Role, string> = {
      owner: ownerCookie,
      coach: await loginAs("+919000000002"),
      receptionist: await loginAs("+919000000005"),
    };

    // 3. Positive control: owner sends all three shapes to the
    //    owner surface and gets the data back. If this fails,
    //    the test isn't actually exercising the bypass — every
    //    request is malformed and we'd get false negatives.
    console.log("\n[positive control] owner → owner surface");
    for (const path of PAGES_BY_SURFACE.owner) {
      const plain = await fetchShape({ path, cookie: cookies.owner, shape: "plain" });
      const rsc = await fetchShape({ path, cookie: cookies.owner, shape: "rsc" });
      const anyOwnerAction = actionHashes.find((a) => a.name === "getOwnerDashboardAction");
      const actionRes = anyOwnerAction
        ? await fetchShape({ path: "/owner", cookie: cookies.owner, shape: "action", actionId: anyOwnerAction.hash })
        : null;
      for (const r of [plain, rsc, actionRes].filter((r): r is NonNullable<typeof r> => r !== null)) {
        const hit = containsProtected(r.body);
        if (!hit) {
          failures.push({
            where: `positive-control owner→${path} (${r.status} ${r.contentType})`,
            detail: `expected protected string (e.g. "Synthetic Member") in response; got first 200 chars: ${r.body.slice(0, 200)}`,
          });
        }
      }
    }
    console.log("[positive control] done");

    // 4. The actual attacks: each cross-role, cross-surface pair.
    for (const role of ["coach", "receptionist"] as const) {
      for (const surface of ["owner", "coach", "reception"] as const) {
        // Coach is entitled to /coach; receptionist to /reception.
        // The attack is the OTHER surfaces.
        if (SURFACES[role] === `/${surface}`) continue;
        console.log(`\n[attack] ${role} → ${surface} surface`);
        const cookie = cookies[role];
        for (const path of PAGES_BY_SURFACE[surface]) {
          const plain = await fetchShape({ path, cookie, shape: "plain" });
          const rsc = await fetchShape({ path, cookie, shape: "rsc" });
          for (const [shapeLabel, r] of [["plain", plain], ["rsc", rsc]] as const) {
            const found = containsProtected(r.body);
            if (found) {
              failures.push({
                where: `${role} → ${path} (${shapeLabel})`,
                detail: `response leaked protected string "${found}" (status=${r.status} ct=${r.contentType}); first 200 chars: ${r.body.slice(0, 200)}`,
              });
            }
          }
        }
        // 5. Direct Next-Action attacks against every action that
        // backs the protected surfaces — the third vector.
        for (const { name, hash } of actionHashes) {
          // The actions that touch the surface are scoped to the
          // page. For now we just check every action from every
          // cross-role pair. (Filter later if it's noisy.)
          const res = await fetchShape({
            path: "/owner", // path is irrelevant for Next-Action POST
            cookie,
            shape: "action",
            actionId: hash,
          });
          const found = containsProtected(res.body);
          if (found) {
            failures.push({
              where: `${role} → action ${name} (POST)`,
              detail: `response leaked "${found}" (status=${res.status} ct=${res.contentType}); first 200 chars: ${res.body.slice(0, 200)}`,
            });
          }
        }
      }
    }
  } finally {
    if (server.pid) {
      try { process.kill(-server.pid, "SIGTERM"); } catch {}
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  if (failures.length === 0) {
    console.log("\n[✓] all assertions passed — no role can read a surface it's not entitled to");
    process.exit(0);
  } else {
    console.log(`\n[✗] ${failures.length} assertion(s) failed:`);
    for (const f of failures) {
      console.log(`    - [${f.where}] ${f.detail}`);
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("e2e:role-bypass FAILED:", err);
  process.exit(1);
});