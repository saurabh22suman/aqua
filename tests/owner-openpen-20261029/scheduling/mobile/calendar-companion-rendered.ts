#!/usr/bin/env tsx
/**
 * Actual rendered check for the short/narrow calendar companion.
 * Seeds only disposable fixture rows, measures Chrome geometry at 1280
 * and the 390 agenda, then removes its own rows. Run through preview helper.
 */
import { chromium, type Page } from "playwright";
import { Pool } from "pg";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE = process.env.AQUA_E2E_BASE_URL ?? "http://127.0.0.1:3273";
const OUT = process.env.AQUA_E2E_OUT ?? ".playwright-mcp/calendar-companion";
const PHONE = process.env.AQUA_E2E_PHONE ?? "+919000000001";
const PIN = process.env.AQUA_E2E_PIN ?? "123456";
const DAY = "2027-06-15";
const NEXT = "2027-06-16";
function toInstant(date: string, time: string): Date {
  return new Date(`${date}T${time}:00+05:30`);
}
mkdirSync(OUT, { recursive: true });

type Finding = { viewport: string; problem: string };
const findings: Finding[] = [];
const fail = (viewport: string, problem: string) => findings.push({ viewport, problem });

async function signIn(page: Page) {
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  const submit = page.locator("form button[type=submit]");
  let enabled = false;
  for (let i = 0; i < 8 && !enabled; i++) {
    await page.fill("#login-phone", PHONE);
    await page.fill("#login-pin", PIN);
    await page.locator("#login-pin").blur();
    enabled = await page.evaluate(() => {
      const b = document.querySelector('form button[type="submit"]') as HTMLButtonElement | null;
      return Boolean(b && !b.disabled);
    });
    if (!enabled) await page.waitForTimeout(750);
  }
  if (!enabled) throw new Error("sign-in never enabled");
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 45_000 }),
    submit.click(),
  ]);
}

async function main() {
  const migration = process.env.MIGRATION_DATABASE_URL;
  if (!migration) throw new Error("MIGRATION_DATABASE_URL missing in check env");
  const db = new Pool({ connectionString: migration });
  const batchIds: string[] = [];
  let programId = "";
  try {
    const tenant = await db.query<{ id: string }>(
      "select id from tenants where slug = 'demo-academy' limit 1",
    );
    const tenantId = tenant.rows[0]?.id;
    if (!tenantId) throw new Error("demo-academy tenant missing");
    const program = await db.query<{ id: string }>(
      "insert into programs (id, tenant_id, name) values (gen_random_uuid(), $1, 'Calendar target fixture') returning id",
      [tenantId],
    );
    programId = program.rows[0]!.id;

    async function add(label: string, startMin: number, durationMin: number, date = DAY) {
      const hh = String(Math.floor(startMin / 60)).padStart(2, "0");
      const mm = String(startMin % 60).padStart(2, "0");
      const endTotal = startMin + durationMin;
      const endDate = endTotal >= 1440 ? NEXT : date;
      const endMin = endTotal % 1440;
      const endHh = String(Math.floor(endMin / 60)).padStart(2, "0");
      const endMm = String(endMin % 60).padStart(2, "0");
      const batch = await db.query<{ id: string }>(
        `insert into batches (id, tenant_id, program_id, name, capacity, days_of_week, start_time, end_time)
         values (gen_random_uuid(), $1, $2, $3, 12, '{5}', $4, $5) returning id`,
        [tenantId, programId, label, `${hh}:${mm}`, `${endHh}:${endMm}`],
      );
      const batchId = batch.rows[0]!.id;
      batchIds.push(batchId);
      const session = await db.query<{ id: string }>(
        `insert into sessions (id, tenant_id, batch_id, session_date, starts_at, ends_at)
         values (gen_random_uuid(), $1, $2, $3, $4, $5) returning id`,
        [
          tenantId,
          batchId,
          date,
          toInstant(date, `${hh}:${mm}`),
          toInstant(endDate, `${endHh}:${endMm}`),
        ],
      );
      return session.rows[0]!.id;
    }

    const ids: Record<string, string> = {};
    ids.m1 = await add("Target 1 minute", 6 * 60, 1);
    ids.m5 = await add("Target 5 minutes", 7 * 60, 5);
    ids.m23 = await add("Target 23 minutes", 8 * 60, 23);
    ids.m30 = await add("Target 30 minutes", 9 * 60, 30);
    ids.m43 = await add("Target 43 minutes", 10 * 60, 43);
    ids.m44 = await add("Target 44 minutes", 11 * 60, 44);
    ids.adj1 = await add("Adjacent 30 A", 18 * 60, 30);
    ids.adj2 = await add("Adjacent 30 B", 18 * 60 + 30, 30);
    ids.ov1 = await add("Overlap 60 A", 16 * 60, 60);
    ids.ov2 = await add("Overlap 60 B", 16 * 60, 60);
    ids.ov3 = await add("Overlap 60 C", 16 * 60, 60);
    ids.night = await add("Overnight target", 23 * 60 + 30, 60);

    const browser = await chromium.launch();
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      await signIn(page);
      await page.goto(`${BASE}/owner/schedule?view=week&date=${DAY}`, {
        waitUntil: "networkidle",
        timeout: 120_000,
      });
      await page.getByTestId("calendar-grid").waitFor({ state: "visible", timeout: 30_000 });

      console.log(await page.evaluate(() => {
        const c = document.querySelector('[data-testid="calendar-short-events"]') as HTMLElement | null;
        const g = document.querySelector('[data-testid="calendar-grid"]') as HTMLElement | null;
        const r = document.querySelector('[data-testid="calendar-ruler"]') as HTMLElement | null;
        return {
          inside: Boolean(c && g && g.contains(c)),
          companionTop: c ? c.getBoundingClientRect().top : null,
          companionBottom: c ? c.getBoundingClientRect().bottom : null,
          gridTop: g ? g.getBoundingClientRect().top : null,
          rulerTop: r ? r.getBoundingClientRect().top : null,
          scrollY: window.scrollY,
        };
      }));
      console.log(await page.evaluate(() => {
        const at = document.elementsFromPoint(255, 599).slice(0, 5).map((el) => ({
          tag: el.tagName,
          cls: (el as HTMLElement).className,
          testid: (el as HTMLElement).dataset?.testid ?? null,
        }));
        const grids = Array.from(document.querySelectorAll('[data-testid="calendar-grid"]')).map((el) => {
          const r = el.getBoundingClientRect();
          return { top: r.top, left: r.left, height: r.height };
        });
        const blocks = Array.from(document.querySelectorAll('[data-testid="calendar-event"]')).slice(0, 3).map((el) => {
          const r = el.getBoundingClientRect();
          return { top: r.top, left: r.left, height: r.height, parent: (el.parentElement as HTMLElement | null)?.dataset?.date ?? null };
        });
        return { at, grids, blocks };
      }));
      const companion = page.getByTestId("calendar-short-events");
      if (!(await companion.isVisible().catch(() => false))) {
        fail("desktop-1280x900", "short-event companion is not visible");
      }
      const rows = companion.getByTestId("calendar-agenda-item");
      const rowCount = await rows.count();
      const expectedRows = 5 + 2 + 3 + 2; // short set + adjacent + overlap + overnight parts
      if (rowCount !== expectedRows) {
        fail("desktop-1280x900", `companion rows ${rowCount}, expected ${expectedRows}`);
      }
      for (const id of Object.values(ids)) {
        const block = page
          .locator(`[data-event-id="${id}"][data-testid="calendar-event"]`)
          .first();
        const isShort = ["m1", "m5", "m23", "m30", "m43"].includes(
          Object.entries(ids).find(([, value]) => value === id)?.[0] ?? "",
        );
        const columns = Number((await block.getAttribute("data-columns")) ?? 1);
        if (isShort || columns > 1) {
          if ((await block.evaluate((el) => el.tagName)) !== "DIV") {
            fail("desktop-1280x900", `short/narrow block ${id} is still interactive`);
          }
        }
        if (id === ids.m44) {
          if ((await block.evaluate((el) => el.tagName)) !== "BUTTON") {
            fail("desktop-1280x900", "44-minute block is not a button");
          }
          const box = await block.boundingBox();
          if (!box || box.height < 43) fail("desktop-1280x900", "44-minute block is shorter than 44px");
        }
        const shortRow = companion.locator(`[data-event-id="${id}"]`);
        if ((isShort || columns > 1) && (await shortRow.count()) === 0) {
          fail("desktop-1280x900", `missing companion row for ${id}`);
        }
      }
      for (const label of ["1 minute", "5 minutes", "23 minutes", "30 minutes", "43 minutes"]) {
        if (!(await companion.getByText(label, { exact: false }).count())) {
          fail("desktop-1280x900", `companion missing ${label}`);
        }
      }
      if (!(await companion.getByText("Continued from previous day").count())) {
        fail("desktop-1280x900", "overnight continuation context missing");
      }
      const focusRow = rows.first();
      await focusRow.focus();
      await page.keyboard.press("Enter");
      const detail = page.getByTestId("calendar-detail");
      await detail.waitFor({ state: "visible", timeout: 20_000 });
      await page.keyboard.press("Escape");
      await detail.waitFor({ state: "detached", timeout: 20_000 }).catch(() => {});
      await page.screenshot({ path: join(OUT, "desktop-1280x900.png"), fullPage: false });

      await page.goto(`${BASE}/owner/schedule?view=day&date=${DAY}`, {
        waitUntil: "networkidle",
      });
      await page.getByTestId("calendar-grid").waitFor({ state: "visible" });
      for (const id of [ids.ov1, ids.ov2, ids.ov3]) {
        const block = page
          .locator(`[data-event-id="${id}"][data-testid="calendar-event"]`)
          .first();
        if ((await block.evaluate((el) => el.tagName)) !== "BUTTON") {
          fail("desktop-1280x900", `roomy Day overlap ${id} is not interactive`);
        }
        const box = await block.boundingBox();
        if (!box || box.width < 44) {
          fail("desktop-1280x900", `roomy Day overlap ${id} is narrower than 44px`);
        }
        if ((await page.getByTestId("calendar-short-events").locator(`[data-event-id="${id}"]`).count()) > 0) {
          fail("desktop-1280x900", `roomy Day overlap ${id} is duplicated in the companion`);
        }
      }
      await page.screenshot({ path: join(OUT, "desktop-day-overlap.png"), fullPage: false });

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(`${BASE}/owner/schedule?view=week&date=${DAY}`, {
        waitUntil: "networkidle",
      });
      const agendaRows = page.locator('[data-testid="calendar-agenda-item"]:visible');
      if ((await agendaRows.count()) === 0) fail("phone-390x844", "agenda has no reachable rows");
      const firstRow = agendaRows.first();
      const rowBox = await firstRow.boundingBox();
      if (!rowBox || rowBox.height < 43) fail("phone-390x844", "agenda row is below 44px");
      await page.screenshot({ path: join(OUT, "phone-390x844.png"), fullPage: false });
      await context.close();
    } finally {
      await browser.close();
    }
  } finally {
    if (batchIds.length > 0) {
      await db.query("delete from sessions where batch_id = any($1::uuid[])", [batchIds]);
      await db.query("delete from batches where id = any($1::uuid[])", [batchIds]);
    }
    if (programId) await db.query("delete from programs where id = $1", [programId]);
    await db.end();
  }
  writeFileSync(join(OUT, "report.json"), JSON.stringify({ findings }, null, 2));
  console.log(JSON.stringify({ findings }, null, 2));
  if (findings.length) process.exitCode = 1;
}
await main();
