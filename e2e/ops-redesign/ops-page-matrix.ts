// Ops redesign (28 October 2026) — the BUILDER's page matrix.
//
// Every one of the twenty approved console routes, in BOTH approved
// presets, at the console's desktop width — plus the viewport variants
// the contract asks for and the long-page scrolling a screenshot
// cannot prove.
//
// WHY IT RUNS IN CHUNKS. The DEV preview restarts itself when it
// approaches its memory threshold, and this laptop is already under
// pressure. One long run that walks every route, every viewport and
// every scroll position in ONE server grows the dev process until it
// restarts mid-sweep — which invalidates the cells after the restart.
//
// So the matrix runs in SMALL SERIAL CHUNKS: each chunk gets its own
// bounded preview server (started and stopped by preview_job.py's own
// finally) and its own five routes in one theme. The cells are written
// to a DURABLE store after every capture, with the SOURCE FINGERPRINT
// they were taken against, so a later chunk can skip a cell that is
// already proven for the SAME source — and a cell taken against a
// DIFFERENT source is re-taken.
//
//   --routes=/ops,/ops/tenants   --theme=mint   --phase=desktop
//
// Phases are isolated too: desktop, responsive and scroll each get
// their own chunk, so no single dev process carries all three.
//
// This is the BUILDER's own pass. It is supplemental: the coordinator
// reviews every page independently afterwards.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { readFixture, signIn } from "./ops-fixture";
import { makeChecker, openConsole } from "./ops-browser";

const ROOT = process.cwd();

const STORE =
  process.env.AQUA_OPS_MATRIX_STORE ??
  "/home/soloengine/Documents/Codex/2026-10-27/continue-work-on-aqua-currently-planned/outputs/ops-implementation-20261028/page-matrix-cells.json";

const OUT =
  process.env.AQUA_E2E_OUT ?? "docs/handoffs/evidence/ops-redesign-20261028";

type Cell = {
  phase: string;
  theme: string;
  viewport: string;
  route: string;
  heading: string | null;
  status: number | null;
  overflow: boolean;
  screenshot: string;
  fingerprint: string;
};

type Store = { cells: Cell[] };

/** The fingerprint of the source a cell was taken against. */
async function sourceFingerprint(): Promise<string> {
  const hash = createHash("sha256");
  const files = [
    "app/(platform)/layout.tsx",
    "app/(platform)/ops",
    "components/ops",
    "components/ui",
    "app/globals.css",
  ];
  const { readdirSync, statSync } = await import("node:fs");
  const walk = async (path: string): Promise<void> => {
    const full = join(ROOT, path);
    if (!existsSync(full)) return;
    if (statSync(full).isDirectory()) {
      for (const entry of readdirSync(full).sort()) {
        await walk(join(path, entry));
      }
    } else if (/\.(tsx?|css)$/.test(full)) {
      hash.update(full);
      hash.update(await readFile(full));
    }
  };
  for (const file of files) await walk(file);
  return hash.digest("hex").slice(0, 16);
}

async function readStore(): Promise<Store> {
  try {
    return JSON.parse(await readFile(STORE, "utf8")) as Store;
  } catch {
    return { cells: [] };
  }
}

async function writeStore(store: Store): Promise<void> {
  await mkdir(dirname(STORE), { recursive: true });
  await writeFile(STORE, JSON.stringify(store, null, 2));
}

async function main() {
  const fixture = readFixture();
  const checker = makeChecker();
  const store = await readStore();
  const fingerprint = await sourceFingerprint();

  const routesArg = process.env.AQUA_OPS_MATRIX_ROUTES ?? "";
  const theme = process.env.AQUA_OPS_MATRIX_THEME ?? "mint";
  const phase = process.env.AQUA_OPS_MATRIX_PHASE ?? "desktop";
  const tenant = fixture.tenantId;
  const presetKey = process.env.AQUA_OPS_PRESET_KEY ?? "";

  const ALL: Array<{
    pattern: string;
    path: string;
    long?: boolean;
    auth?: "login" | "verify";
  }> = [
    { pattern: "/ops", path: "/ops" },
    { pattern: "/ops/tenants", path: "/ops/tenants" },
    { pattern: "/ops/tenants/new", path: "/ops/tenants/new" },
    { pattern: "/ops/tenants/[tenantId]", path: `/ops/tenants/${tenant}` },
    {
      pattern: "/ops/tenants/[tenantId]/configuration",
      path: `/ops/tenants/${tenant}/configuration`,
      long: true,
    },
    {
      pattern: "/ops/tenants/[tenantId]/entitlements",
      path: `/ops/tenants/${tenant}/entitlements`,
    },
    {
      pattern: "/ops/tenants/[tenantId]/locations",
      path: `/ops/tenants/${tenant}/locations`,
    },
    {
      pattern: "/ops/tenants/[tenantId]/messaging",
      path: `/ops/tenants/${tenant}/messaging`,
    },
    {
      pattern: "/ops/tenants/[tenantId]/tax",
      path: `/ops/tenants/${tenant}/tax`,
    },
    {
      pattern: "/ops/tenants/[tenantId]/audit",
      path: `/ops/tenants/${tenant}/audit`,
      long: true,
    },
    { pattern: "/ops/leads", path: "/ops/leads" },
    { pattern: "/ops/leads/new", path: "/ops/leads/new" },
    { pattern: "/ops/leads/[leadId]", path: `/ops/leads/${fixture.leadId}` },
    { pattern: "/ops/features", path: "/ops/features", long: true },
    { pattern: "/ops/presets", path: "/ops/presets" },
    { pattern: "/ops/presets/[key]", path: `/ops/presets/${presetKey}` },
    { pattern: "/ops/whatsapp", path: "/ops/whatsapp" },
    { pattern: "/ops/activity", path: "/ops/activity", long: true },
    { pattern: "/ops/login", path: "/ops/login", auth: "login" },
    { pattern: "/ops/verify", path: "/ops/verify", auth: "verify" },
  ];

  const wanted = routesArg
    ? routesArg.split(",").map((r) => r.trim()).filter(Boolean)
    : ALL.map((r) => r.pattern);
  const routes = ALL.filter((r) => wanted.includes(r.pattern));

  const session = await openConsole({ width: 1280, height: 900 });
  const { page, base } = session;
  // The DEV preview restarts itself near its memory threshold, and the
  // first load after a restart compiles again.
  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(120_000);
  await mkdir(OUT, { recursive: true });

  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(String(error)));

  const key = (phase: string, th: string, viewport: string, route: string) =>
    `${phase}|${th}|${viewport}|${route}`;

  try {
    if (!routes.some((route) => route.auth)) {
      await signIn(page, base, fixture.operator);
    }

    await page.context().addCookies([
      { name: "aqua_theme", value: theme, url: base },
    ]);

    for (const route of routes) {
      const cellKey = key(phase, theme, "1280x900", route.pattern);
      const already = store.cells.find(
        (cell) =>
          `${cell.phase}|${cell.theme}|${cell.viewport}|${cell.route}` ===
            cellKey && cell.fingerprint === fingerprint,
      );
      if (already) {
        console.log(`SKIP ${cellKey} (already proven for this source)`);
        continue;
      }

      if (route.auth) {
        // The auth screens get their OWN isolated context: an
        // authenticated session would send /ops/login straight to the
        // console, and the pending challenge is spent once.
        const context = await session.browser.newContext({
          viewport: { width: 1280, height: 900 },
        });
        const authPage = await context.newPage();
        try {
          await authPage.context().addCookies([
            { name: "aqua_theme", value: theme, url: base },
          ]);
          if (route.auth === "verify") {
            await authPage.goto(`${base}/ops/login`, {
              waitUntil: "domcontentloaded",
            });
            await authPage.getByLabel("Email", { exact: true }).waitFor();
            await authPage
              .getByLabel("Email", { exact: true })
              .fill(fixture.operator.email);
            await authPage
              .getByLabel("Password", { exact: true })
              .fill(fixture.operator.password);
            await authPage
              .getByRole("button", { name: "Continue", exact: true })
              .click();
            await authPage.waitForURL("**/ops/verify");
          }
          const cell = await capture(authPage, `${base}${route.path}`, theme);
          store.cells = upsert(store.cells, { ...cell, phase, theme, viewport: "1280x900", route: route.pattern, fingerprint });
          await writeStore(store);
        } finally {
          await context.close();
        }
        continue;
      }

      const viewports =
        phase === "responsive"
          ? (process.env.AQUA_OPS_MATRIX_VIEWPORTS ?? "1280x600,1024x768,390x844")
              .split(",")
              .map((v) => v.trim())
              .filter(Boolean)
          : ["1280x900"];

      for (const viewport of viewports) {
        const [width, height] = viewport.split("x").map(Number);
        await page.setViewportSize({ width: width!, height: height! });
        const cell = await capture(page, `${base}${route.path}`, theme);
        store.cells = upsert(store.cells, {
          ...cell,
          phase,
          theme,
          viewport,
          route: route.pattern,
          fingerprint,
        });
        await writeStore(store);
      }
      await page.setViewportSize({ width: 1280, height: 900 });

      if (phase === "scroll" && route.long) {
        // The long pages are scrolled to the top, the middle and the
        // bottom: a screenshot of the top cannot prove that the rail
        // and the exit control survive the scroll.
        for (const position of ["top", "middle", "bottom"]) {
          await page.evaluate((where) => {
            const scrolling = document.scrollingElement;
            if (!scrolling) return;
            const max = scrolling.scrollHeight - scrolling.clientHeight;
            window.scrollTo(0, where === "top" ? 0 : where === "middle" ? max / 2 : max);
          }, position);
          await page.waitForTimeout(200);
          await page.screenshot({
            path: `${OUT}/scroll-${route.pattern.replace(/[^a-z0-9]+/gi, "-")}-${position}-${theme}.png`,
          });
        }
      }
    }

    await checker.check(
      "every cell in this chunk rendered cleanly, with no console error",
      async () => {
        const mine = store.cells.filter(
          (cell) =>
            cell.fingerprint === fingerprint &&
            cell.theme === theme &&
            cell.phase === phase &&
            wanted.includes(cell.route),
        );
        const broken = mine.filter(
          (cell) => cell.status !== 200 || cell.overflow || cell.heading === null,
        );
        assert.equal(
          broken.length,
          0,
          `cells that did not render cleanly:\n${JSON.stringify(broken, null, 2)}`,
        );
        assert.equal(
          consoleErrors.length,
          0,
          `the browser logged errors:\n${consoleErrors.join("\n")}`,
        );
        console.log(
          `chunk ${phase}/${theme}: ${mine.length} cell(s) proven for source ${fingerprint}`,
        );
      },
    );
  } finally {
    await session.context.close().catch(() => undefined);
    await session.browser.close().catch(() => undefined);
    await writeStore(store);
    await checker.writeResults(`ops-page-matrix-${phase}-${theme}.json`);
  }

  if (checker.failed) process.exitCode = 1;
}

function upsert(cells: Cell[], cell: Cell): Cell[] {
  const index = cells.findIndex(
    (existing) =>
      existing.phase === cell.phase &&
      existing.theme === cell.theme &&
      existing.viewport === cell.viewport &&
      existing.route === cell.route,
  );
  if (index === -1) return [...cells, cell];
  const next = [...cells];
  next[index] = cell;
  return next;
}

/** Navigate, retrying once: the DEV preview may be restarting. */
async function gotoWithRetry(
  page: import("playwright").Page,
  url: string,
): Promise<import("playwright").Response | null> {
  try {
    return await page.goto(url, { waitUntil: "domcontentloaded" });
  } catch {
    await page.waitForTimeout(3000);
    return await page.goto(url, { waitUntil: "domcontentloaded" });
  }
}

/** Load a page, read its facts and photograph it. */
async function capture(
  page: import("playwright").Page,
  url: string,
  theme: string,
): Promise<Omit<Cell, "phase" | "theme" | "viewport" | "route" | "fingerprint">> {
  let response = await gotoWithRetry(page, url);
  await page.waitForLoadState("load");
  await page.waitForTimeout(250);

  // The DEV preview restarts itself near its memory threshold, and a
  // restart reloads the open page — which destroys the execution
  // context mid-measurement. The measurement is retried against a
  // freshly loaded page rather than being lost.
  let facts: { heading: string | null; overflow: boolean } | null = null;
  for (let attempt = 0; attempt < 3 && !facts; attempt += 1) {
    try {
      facts = await page.evaluate(() => {
        const h1 = document.querySelector("h1");
        return {
          heading: h1 ? (h1.textContent ?? "").trim() : null,
          overflow: document.documentElement.scrollWidth > window.innerWidth + 1,
        };
      });
    } catch {
      await page.waitForTimeout(1500);
      response = await gotoWithRetry(page, url);
      await page.waitForLoadState("load");
      await page.waitForTimeout(250);
    }
  }
  if (!facts) {
    throw new Error(`could not measure ${url} — the page kept navigating`);
  }
  const { heading, overflow } = facts;
  const name =
    resolve(url)
      .replace(/^https?:\/\/[^/]+/, "")
      .replace(/[^a-z0-9]+/gi, "-")
      .replace(/^-|-$/g, "") || "root";
  const screenshot = `${name}-${theme}.png`;
  await page.screenshot({ path: `${OUT}/${screenshot}` });
  return { heading, status: response?.status() ?? null, overflow, screenshot };
}

main().catch((error) => {
  console.error("The Ops page matrix chunk could not run.");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
