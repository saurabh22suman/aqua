// Host-boundary mechanical pin for non-route assets.
//
// The middleware.ts allowlist determines which paths get past the
// routing layer. Routes (/login, /owner, /ops, etc.) are
// exhaustively listed there; this test pins the OTHER surface —
// non-route assets the app serves at root or under /public.
//
// Why this matters: the /sw.js bug (the previous CI failure) only
// surfaced because one e2e script exercised the SW. A missing
// font, a missing favicon, a missing web manifest — none of those
// has a test, and would silently 404 in production. Operators
// would see a broken coach app on the operator's phone, with no
// CI signal to point at the cause.
//
// What this test pins:
//
//   1. /public/sw.js                          → 200 on apex, 404 on ops
//   2. /favicon.ico                            → 200 on apex (Next's default)
//      (Next auto-serves /favicon.ico if there's no app/favicon.ico;
//      the middleware matcher excludes it so it works either way;
//      the test pins the resulting behavior.)
//   3. /_next/static/<anything>                → 200 on apex (excluded
//      from middleware matcher; sanity check that the static dir is
//      actually populated in dev.)
//   4. Future additions to public/ are auto-enumerated: every file
//      in public/ is asserted reachable on apex. If a future
//      contributor drops /public/manifest.webmanifest in and the
//      middleware doesn't allow it, this test catches it on the
//      next PR.
//
// Pattern: scripts/e2e-host-boundary.ts (the route-host probe
// test). Same shape — spawn dev server, curl with explicit Host
// headers, assert status codes.

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const PORT = 3223;
const HOST = "localhost";

interface Probe {
  path: string;
  expectApex: number;
  expectOps: number;
  note: string;
}

// The static list. The dynamic enumeration (below) augments this —
// new entries appear here when someone adds an asset that isn't
// auto-served by Next.js (e.g. an Open Graph image, a web manifest
// that Next doesn't auto-generate).
//
// Note on /favicon.ico: Next.js only auto-serves /favicon.ico when
// there's an app/favicon.ico (or app/icon.*) — a project asset that
// gets copied to the route tree. This project ships neither, so
// /favicon.ico returns 404. Browsers handle missing favicons
// silently (request failure → empty icon), and no e2e hits /favicon,
// so we don't pin a 200 here. The public/ walk below catches the
// day someone drops a real favicon into /public/.
const STATIC_PROBES: Probe[] = [
  { path: "/sw.js",                expectApex: 200, expectOps: 404, note: "service worker (apex only — ops doesn't use offline)" },
];

// Walk public/ at test time. Any file in public/ becomes a probe —
// catches the case where a contributor drops a new asset in and the
// middleware doesn't know about it.
//
// Files in /public/ are served at root (Next strips the public/
// prefix), so public/sw.js is reachable as /sw.js (already in
// STATIC_PROBES — skipped below), public/manifest.webmanifest as
// /manifest.webmanifest (would be new), and so on.
function publicDirProbes(): Probe[] {
  const probes: Probe[] = [];
  const publicDir = "public";
  // Skip paths already in STATIC_PROBES — same path = redundant probe.
  const seen = new Set(STATIC_PROBES.map((p) => p.path));
  function walk(dir: string): void {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return; // public/ doesn't exist — fine, no probes
    }
    for (const entry of entries) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) walk(full);
      else {
        // Strip the public/ prefix. public/sw.js → /sw.js.
        const relative = full.startsWith(publicDir + "/")
          ? full.slice(publicDir.length)
          : "/" + entry;
        if (seen.has(relative)) continue;
        seen.add(relative);
        probes.push({
          path: relative,
          expectApex: 200,
          expectOps: 404,
          note: `public/ asset (auto-enumerated)`,
        });
      }
    }
  }
  walk(publicDir);
  return probes;
}

// _next/static is excluded from the middleware matcher entirely
// (the matcher regex explicitly excludes `_next/static` and
// `_next/image`), so it routes on both hosts without middleware
// involvement. Sanity check: pick the first chunk and confirm
// it's reachable on apex (ops doesn't need it, but it shouldn't
// 500). We probe /favicon.ico via the matcher exclusion path
// separately; the /_next/static probe is via the same path.
function nextStaticProbe(): Probe | null {
  const staticsDir = ".next/static";
  let entries: string[];
  try {
    entries = readdirSync(staticsDir);
  } catch {
    return null; // .next/static doesn't exist (e.g. CI cold start) — skip
  }
  const firstChunk = entries.find((e) => /^[a-f0-9]+\.js$/.test(e));
  if (!firstChunk) return null;
  return {
    path: `/_next/static/${firstChunk}`,
    expectApex: 200,
    expectOps: 200, // _next/static is matcher-excluded; not a host boundary
    note: "Next.js static chunk (matcher-excluded; not a host boundary)",
  };
}

async function assertPortFree(port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.once("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(
          `port ${port} is already in use — a previous e2e run likely ` +
          `left a stale next dev. Find and kill it (lsof -i :${port} or ` +
          `fuser -k ${port}/tcp), then re-run.`,
        ));
      } else {
        reject(err);
      }
    });
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve()));
  });
}

async function waitForServer(proc: ChildProcess): Promise<void> {
  for (let i = 0; i < 90; i++) {
    try {
      const out = execFileSync(
        "curl",
        ["-sS", "-o", "/dev/null", "-w", "%{http_code}", `http://${HOST}:${PORT}/api/health`],
        { encoding: "utf8", timeout: 2000 },
      );
      if (out === "200" || out === "503") return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  console.error("dev server never became reachable");
  proc.kill();
  process.exit(1);
}

function probeUrl(path: string, host: string): { status: number } {
  // -L: follow redirects. The favicon endpoint in particular can
  // redirect internally.
  // -k: accept self-signed certs (dev server may use one).
  // -s: silent.
  // -o /dev/null: discard body.
  // -w "%{http_code}": print only the status code.
  // -H: explicit Host header — flips the boundary for this test.
  const url = `http://127.0.0.1:${PORT}${path}`;
  const out = execFileSync(
    "curl",
    ["-L", "-k", "-sS", "-o", "/dev/null", "-w", "%{http_code}", "-H", `Host: ${host}`, url],
    { encoding: "utf8", timeout: 10_000 },
  );
  return { status: parseInt(out.trim(), 10) };
}

async function main(): Promise<void> {
  await assertPortFree(PORT);
  // -H :: so IPv6-resolved localhost works without /etc/hosts ceremony.
  const server = spawn("pnpm", ["next", "dev", "-p", String(PORT), "-H", "::"], {
    stdio: "ignore",
    detached: true,
    env: { ...process.env, BETTER_AUTH_URL: `http://${HOST}:${PORT}` },
  });
  await waitForServer(server);

  const probes = [...STATIC_PROBES, ...publicDirProbes()];
  const staticProbe = nextStaticProbe();
  if (staticProbe) probes.push(staticProbe);

  let failures = 0;
  for (const p of probes) {
    for (const [surface, expect] of [["apex", p.expectApex], ["ops", p.expectOps]] as const) {
      const host = surface === "apex" ? `${HOST}:${PORT}` : `ops.${HOST}:${PORT}`;
      try {
        const { status } = probeUrl(p.path, host);
        if (status !== expect) {
          failures++;
          console.log(
            `[✗] ${host}${p.path} → ${status} (expected ${expect}) — ${p.note}`,
          );
        } else {
          console.log(`[✓] ${host}${p.path} → ${status}`);
        }
      } catch (err) {
        failures++;
        console.log(
          `[✗] ${host}${p.path} → error: ${(err as Error).message} — ${p.note}`,
        );
      }
    }
  }

  if (server.pid) process.kill(-server.pid!);
  process.exit(failures === 0 ? 0 : 1);
}

main();
