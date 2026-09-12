// Host-boundary mechanical pin.
//
// A — the platform is on its own subdomain (ops.<base>). The
// boundary between ops.<base> and apex is enforced by middleware.ts
// and pinned by THIS test. Without it, a future route group move
// or middleware refactor could silently re-enable /ops on apex
// (or /owner on ops) and the only thing left enforcing the
// boundary would be the layout auth gates — which would let a
// platform admin navigate to /owner on their own host without
// being blocked at the routing layer. The boundary is a
// security claim, not just a UX claim.
//
// What this test pins:
//
//   1. From ops.<base>:
//        - /ops/login       200 (platform login reachable)
//        - /ops/            200 (platform overview, with auth)
//        - /login           404 (tenant login NOT reachable)
//        - /owner           404
//        - /coach           404
//        - /reception       404
//        - /parent          404
//        - /p/anything      404
//
//   2. From apex (<base>):
//        - /ops/login       404
//        - /ops/            404
//        - /login           200 (or 307 to login)
//        - /api/health      200
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

// Both "ops" and the apex share the same dev server. The Host
// header is the only thing that flips the boundary.
const PROBES: Probe[] = [
  // From ops.<base>:
  { path: "/ops/login",       host: `ops.localhost:${PORT}`, expect: 200, note: "platform login reachable on ops" },
  // /ops/ on ops reaches the platform overview (which itself
  // redirects unauthed users to /ops/verify → /ops/login). With
  // -L following redirects, the final status is the platform
  // login (200). The point of this probe is "did the request
  // reach ops at all" — the 200 confirms yes. The corresponding
  // apex probe below pins "did NOT reach" via the 404 chain.
  { path: "/ops/",            host: `ops.localhost:${PORT}`, expect: 200, note: "platform surface reachable on ops (follows auth redirects)" },
  { path: "/login",           host: `ops.localhost:${PORT}`, expect: 404, note: "tenant login NOT reachable on ops" },
  { path: "/owner",           host: `ops.localhost:${PORT}`, expect: 404, note: "/owner NOT reachable on ops" },
  { path: "/coach",           host: `ops.localhost:${PORT}`, expect: 404, note: "/coach NOT reachable on ops" },
  { path: "/reception",       host: `ops.localhost:${PORT}`, expect: 404, note: "/reception NOT reachable on ops" },
  { path: "/parent",          host: `ops.localhost:${PORT}`, expect: 404, note: "/parent NOT reachable on ops" },
  { path: "/p/anything",      host: `ops.localhost:${PORT}`, expect: 404, note: "parent magic-link NOT reachable on ops" },
  { path: "/api/health",      host: `ops.localhost:${PORT}`, expect: 200, note: "health reachable on ops (Traefik / Dokploy check)" },
  // 2026-09-11 auth feature: the phone+PIN and set-PIN routes are
  // apex-only. On ops they must 404 (never reach the tenant auth
  // surface); on the apex they exist (405 on GET, because they are
  // POST-only — a 404 here would mean the middleware dropped them).
  { path: "/api/login/pin",       host: `ops.localhost:${PORT}`, expect: 404, note: "tenant PIN login NOT reachable on ops" },
  { path: "/api/account/set-pin", host: `ops.localhost:${PORT}`, expect: 404, note: "tenant set-PIN NOT reachable on ops" },
  // From apex:
  { path: "/ops/login",       host: `localhost:${PORT}`,     expect: 404, note: "/ops NOT reachable on apex" },
  { path: "/ops/",            host: `localhost:${PORT}`,     expect: 404, note: "/ops/* NOT reachable on apex" },
  { path: "/login",           host: `localhost:${PORT}`,     expect: 200, note: "tenant login reachable on apex" },
  { path: "/api/health",      host: `localhost:${PORT}`,     expect: 200, note: "health reachable on apex" },
  { path: "/api/login/pin",       host: `localhost:${PORT}`, expect: 405, note: "PIN login reachable on apex (POST-only -> 405 on GET)" },
  { path: "/api/account/set-pin", host: `localhost:${PORT}`, expect: 405, note: "set-PIN reachable on apex (POST-only -> 405 on GET)" },
];

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

async function main(): Promise<void> {
  await assertPortFree(PORT);
  // Bind to :: (dual-stack) so curl can hit ops.localhost (which
  // resolves to ::1 on most systems) AND 127.0.0.1 without
  // forcing IPv4 with -4.
  const server = spawn("pnpm", ["next", "dev", "-p", String(PORT), "-H", "::"], {
    stdio: "ignore",
    detached: true,
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

  if (server.pid) process.kill(-server.pid!);
  process.exit(failures === 0 ? 0 : 1);
}

main();
