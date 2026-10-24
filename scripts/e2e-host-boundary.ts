// Host-boundary mechanical pin.
//
// A — the platform is on its own host. It used to be a subdomain of
// the tenant apex (`ops.<base>`); it is now a SIBLING host
// (aquaops.preprabbit.in beside aqua.preprabbit.in), named
// by OPS_HOST. The boundary between the platform host and the apex
// is enforced by middleware.ts and pinned by THIS test. Without it, a
// future route group move or middleware refactor could silently
// re-enable /ops on apex (or /owner on the platform host) and the
// only thing left enforcing the boundary would be the layout auth
// gates — which would let a platform admin navigate to /owner on
// their own host without being blocked at the routing layer. The
// boundary is a security claim, not just a UX claim.
//
// What this test pins:
//
//   1. From the platform host (OPS_HOST):
//        - /ops/login       200 (platform login reachable)
//        - /ops/            200 (platform overview, with auth)
//        - /login           404 (tenant login NOT reachable)
//        - /owner           404
//        - /coach           404
//        - /reception       404
//        - /parent          404
//        - /p/anything      404
//        - /check-in/…      404 (premises QR is a tenant surface)
//
//   2. From the apex:
//        - /ops/login       404
//        - /ops/            404
//        - /login           200 (or 307 to login)
//        - /api/health      200
//        - /check-in/…      200 (signed-out sign-in-first state)
//
//   3. The legacy `ops.<base>` shape still resolves to the platform
//      surface — local development (ops.localhost) and any older
//      deployment depend on it.
//
// 404 is the contract — anything else means the boundary is open.
// The middleware returns plain-text "not found" with status 404
// (middleware.ts:104); we don't care about the body, only the
// status code.
//
// Spawns its own dev server (matching the e2e-login.ts /
// e2e-platform-form-leak.ts pattern). Uses curl with explicit
// Host headers — no browser, no Playwright, no /etc/hosts
// ceremony. The middleware reads Host from the request headers,
// not from the connection's source address; curl's -H passes
// exactly what the test asserts on.

import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";

const PORT = 3222;

// The deployed host pair. The platform host is named by OPS_HOST; the
// apex is its sibling. These are the hosts the Dokploy deployment
// routes, so the boundary is pinned in its real shape — a host
// pattern nobody deploys would not prove anything.
const PLATFORM_HOST = "aquaops.preprabbit.in";
const APEX_HOST = "aqua.preprabbit.in";

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

interface Probe {
  path: string;
  host: string;
  expect: number;
  note: string;
}

interface Expectation {
  path: string;
  expect: number;
  note: string;
}

// The bare domain is an ENTRY POINT, and its redirect is asserted
// separately (see REDIRECT_PROBES) because "where does it send you"
// is the whole point: a bare domain that answered 404 was the bug,
// and one that redirected to the OTHER app's door would be a boundary
// breach.
//
// These probes read the redirect itself — they do NOT follow it — so
// they can assert the status AND the destination.
interface RedirectProbe {
  host: string;
  expectPath: string;
  note: string;
}

// The path contract, per surface. It does not mention hosts: the same
// expectations must hold for every host spelling that reaches the
// app, which is the whole point of the pin.
const PLATFORM_EXPECTATIONS: Expectation[] = [
  { path: "/ops/login",       expect: 200, note: "platform login reachable on the platform host" },
  // /ops/ on the platform host reaches the platform overview (which
  // itself redirects unauthed users to /ops/verify → /ops/login).
  // With -L following redirects, the final status is the platform
  // login (200). The point of this probe is "did the request reach
  // the platform surface at all" — the 200 confirms yes. The
  // corresponding apex probe below pins "did NOT reach" via the 404
  // chain.
  { path: "/ops/",            expect: 200, note: "platform surface reachable (follows auth redirects)" },
  { path: "/login",           expect: 404, note: "tenant login NOT reachable" },
  { path: "/owner",           expect: 404, note: "/owner NOT reachable" },
  { path: "/coach",           expect: 404, note: "/coach NOT reachable" },
  { path: "/reception",       expect: 404, note: "/reception NOT reachable" },
  { path: "/parent",          expect: 404, note: "/parent NOT reachable" },
  { path: "/p/anything",      expect: 404, note: "parent magic-link NOT reachable" },
  { path: "/check-in/anything", expect: 404, note: "premises check-in NOT reachable (tenant surface)" },
  { path: "/api/health",      expect: 200, note: "health reachable (Traefik / Dokploy check)" },
  // 2026-09-11 auth feature: the phone+PIN and set-PIN routes are
  // apex-only. On the platform host they must 404 (never reach the
  // tenant auth surface); on the apex they exist (405 on GET, because
  // they are POST-only — a 404 here would mean the middleware dropped
  // them).
  { path: "/api/login/pin",       expect: 404, note: "tenant PIN login NOT reachable" },
  { path: "/api/login/pin-recovery", expect: 404, note: "tenant recovery NOT reachable" },
  { path: "/api/offline/session", expect: 404, note: "offline identity NOT reachable" },
  { path: "/ops/api/whatsapp-auth", expect: 405, note: "ops OTP endpoint reachable, POST only" },
  { path: "/api/account/set-pin", expect: 404, note: "tenant set-PIN NOT reachable" },
];

const APEX_EXPECTATIONS: Expectation[] = [
  { path: "/ops/login",       expect: 404, note: "/ops NOT reachable on apex" },
  { path: "/ops/",            expect: 404, note: "/ops/* NOT reachable on apex" },
  { path: "/login",           expect: 200, note: "tenant login reachable on apex" },
  { path: "/api/health",      expect: 200, note: "health reachable on apex" },
  { path: "/api/login/pin",       expect: 405, note: "PIN login reachable on apex (POST-only -> 405 on GET)" },
  { path: "/api/login/pin-recovery", expect: 405, note: "tenant recovery reachable, POST only" },
  { path: "/api/offline/session", expect: 200, note: "offline identity reachable without exposing a signed-out scope" },
  { path: "/ops/api/whatsapp-auth", expect: 404, note: "ops OTP endpoint NOT reachable on apex" },
  { path: "/api/account/set-pin", expect: 405, note: "set-PIN reachable on apex (POST-only -> 405 on GET)" },
  { path: "/check-in/anything",   expect: 200, note: "premises check-in reachable on apex (signed-out sign-in-first state)" },
];

// Both host shapes share the same dev server. The Host header is the
// only thing that flips the boundary.
//
// The configured pair is the deployed shape: OPS_HOST names the
// platform host, and the apex is its sibling. The legacy pair is the
// `ops.<base>` shape that local development and older deployments
// still use — it must keep resolving to the platform surface, so the
// platform host is not the only way in.
const HOST_PAIRS: { platform: string; apex: string; label: string }[] = [
  { platform: PLATFORM_HOST, apex: APEX_HOST, label: "configured OPS_HOST" },
  { platform: "ops.localhost", apex: "localhost", label: "legacy ops.<base> shape" },
];

const PROBES: Probe[] = HOST_PAIRS.flatMap((pair) => [
  ...PLATFORM_EXPECTATIONS.map((e) => ({
    path: e.path,
    host: `${pair.platform}:${PORT}`,
    expect: e.expect,
    note: `${e.note} (${pair.label})`,
  })),
  ...APEX_EXPECTATIONS.map((e) => ({
    path: e.path,
    host: `${pair.apex}:${PORT}`,
    expect: e.expect,
    note: `${e.note} (${pair.label})`,
  })),
]);

// The bare domain must open the right app on each host.
//
// The assertion is on the REDIRECT, not on the page it lands on: the
// destination must be the same host that was asked for (a redirect to
// the other app's host would be a boundary breach) and the right path
// on it (the tenant door on the apex, the platform door on the ops
// host). The status must be a real redirect — a redirect decided
// during render answers 200 and hides the destination in the RSC
// payload, which is not an entry point any client can follow.
const REDIRECT_PROBES: RedirectProbe[] = HOST_PAIRS.flatMap((pair) => [
  {
    host: `${pair.platform}:${PORT}`,
    expectPath: "/ops",
    note: `bare domain opens the platform app (${pair.label})`,
  },
  {
    host: `${pair.apex}:${PORT}`,
    expectPath: "/login",
    note: `bare domain opens the tenant app (${pair.label})`,
  },
]);

async function waitForServer(proc: ChildProcess): Promise<void> {
  for (let i = 0; i < 90; i++) {
    try {
      const out = execFileSync(
        "curl",
        ["-sS", "-o", "/dev/null", "-w", "%{http_code}", `http://localhost:${PORT}/api/health`],
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

function probeUrl(p: Probe): { url: string; status: number } {
  const url = `http://127.0.0.1:${PORT}${p.path}`;
  // -L: follow redirects. Next.js does a 308 trailing-slash
  // redirect for any URL with a trailing slash (default
  // `trailingSlash: false` config); we want the FINAL response
  // status, not the redirect's. The middleware still enforces
  // the boundary at the redirect target — if it didn't, the
  // final status would leak through, and this test would catch
  // it.
  // -k: accept self-signed certs (dev server may use one).
  // -s: silent.
  // -o /dev/null: discard body.
  // -w "%{http_code}": print only the status code.
  // -H: explicit Host header — the only thing that flips the
  // boundary for this test.
  const out = execFileSync(
    "curl",
    ["-L", "-k", "-sS", "-o", "/dev/null", "-w", "%{http_code}", "-H", `Host: ${p.host}`, url],
    { encoding: "utf8", timeout: 10_000 },
  );
  return { url, status: parseInt(out.trim(), 10) };
}

function probeRedirect(p: RedirectProbe): { status: number; location: string } {
  // NO -L here: following the redirect would hide the destination,
  // which is the thing under test. The raw Location header is the
  // contract.
  const out = execFileSync(
    "curl",
    [
      "-k",
      "-sS",
      "-o",
      "/dev/null",
      "-D",
      "-",
      "-H",
      `Host: ${p.host}`,
      `http://127.0.0.1:${PORT}/`,
    ],
    { encoding: "utf8", timeout: 10_000 },
  );
  const status = parseInt(out.match(/^HTTP\/[\d.]+ (\d+)/m)?.[1] ?? "0", 10);
  const location = out.match(/^location:\s*(.+)$/im)?.[1]?.trim() ?? "";
  return { status, location };
}

async function main(): Promise<void> {
  await assertPortFree(PORT);
  // Bind to :: (dual-stack) so curl can hit ops.localhost (which
  // resolves to ::1 on most systems) AND 127.0.0.1 without
  // forcing IPv4 with -4.
  //
  // OPS_HOST is set explicitly: the dev server must resolve the
  // platform host the way the deployment does, from configuration,
  // not from a host-name convention baked into the source.
  const server = spawn("pnpm", ["next", "dev", "-p", String(PORT), "-H", "::"], {
    stdio: "ignore",
    detached: true,
    env: { ...process.env, OPS_HOST: PLATFORM_HOST },
  });
  await waitForServer(server);

  let failures = 0;
  for (const p of PROBES) {
    try {
      const { url, status } = probeUrl(p);
      if (status !== p.expect) {
        failures++;
        console.log(
          `[✗] ${p.host}${p.path} → ${status} (expected ${p.expect}) — ${p.note}`,
        );
        console.log(`    url: ${url}`);
      } else {
        console.log(`[✓] ${p.host}${p.path} → ${status}`);
      }
    } catch (err) {
      failures++;
      console.log(
        `[✗] ${p.host}${p.path} → error: ${(err as Error).message} — ${p.note}`,
      );
    }
  }

  for (const p of REDIRECT_PROBES) {
    try {
      const { status, location } = probeRedirect(p);
      const path = location.replace(/^https?:\/\/[^/]+/, "");
      const host = location.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      const ok =
        status === 307 &&
        path === p.expectPath &&
        host === p.host;
      if (!ok) {
        failures++;
        console.log(
          `[✗] ${p.host}/ → ${status} ${location || "(no Location)"} (expected 307 to ${p.expectPath} on ${p.host}) — ${p.note}`,
        );
      } else {
        console.log(`[✓] ${p.host}/ → ${status} → ${path} (same host)`);
      }
    } catch (err) {
      failures++;
      console.log(
        `[✗] ${p.host}/ → error: ${(err as Error).message} — ${p.note}`,
      );
    }
  }

  if (server.pid) process.kill(-server.pid!);
  process.exit(failures === 0 ? 0 : 1);
}
main();
