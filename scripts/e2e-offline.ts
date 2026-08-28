import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { Pool } from "pg";
import { env } from "@/lib/env";
import {
  attendanceRows,
  cleanupOfflineFixture,
  setupOfflineFixture,
  type OfflineFixture,
} from "./lib/offline-fixture";
import {
  domStatuses,
  gotoRegister,
  loginAsCoach,
  makeRecorder,
  markAll,
  waitForQueueDrain,
  waitForServer,
} from "./lib/offline-page";
import { runVerify5, runVerify6, runVerifyColdStart } from "./lib/offline-verify";

const BASE = "http://localhost:3215";
const MEMBER_COUNT = 16;
const RUN = Date.now().toString(36);
const COACH_PHONE = "+91 90000 00002";

const { results, record } = makeRecorder();

async function main() {
  const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
  const server = spawn("pnpm", ["next", "dev", "-p", "3215"], {
    stdio: "ignore",
    detached: true,
  });

  let fixture: OfflineFixture | undefined;
  const browser = await chromium.launch();

  try {
    await waitForServer(BASE);
    fixture = await setupOfflineFixture(admin, RUN, MEMBER_COUNT);
    console.log(`fixture ready — session ${fixture.sessionId}, ${fixture.memberIds.length} members`);

    // ============================================================
    // VERIFY 1 — mark all 16 offline, hard refresh while still offline,
    // all 16 marks still present (in the UI, not just "not lost server-side").
    // ============================================================
    {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await loginAsCoach(context, BASE, COACH_PHONE);
      await gotoRegister(page, BASE, fixture.sessionId);
      // Warm the service worker's cache for this URL while still online —
      // a hard refresh offline can only serve a shell that was cached at
      // least once.
      await page.waitForTimeout(1500);

      await context.setOffline(true);
      await markAll(page, fixture.memberIds, "Present");

      const beforeReload = await domStatuses(page);
      const markedBeforeReload = Object.values(beforeReload).filter((s) => s === "present").length;

      await page.reload();
      await page.waitForTimeout(1500);
      const afterReload = await domStatuses(page).catch(() => ({}) as Record<string, string>);
      const markedAfterReload = Object.values(afterReload).filter((s) => s === "present").length;

      if (markedBeforeReload === MEMBER_COUNT && markedAfterReload === MEMBER_COUNT) {
        record("VERIFY 1: 16 marks survive hard refresh while offline", "PASS", `${markedAfterReload}/${MEMBER_COUNT} present after reload`);
      } else {
        record(
          "VERIFY 1: 16 marks survive hard refresh while offline",
          "FAIL",
          `before reload: ${markedBeforeReload}/${MEMBER_COUNT}, after reload: ${markedAfterReload}/${MEMBER_COUNT}`,
        );
      }

      await context.setOffline(false);
      const drained = await waitForQueueDrain(page);
      const rows = await attendanceRows(admin, fixture.sessionId);

      // ============================================================
      // VERIFY 2 — reconnect, all 16 sync, row count exactly 16.
      // ============================================================
      if (drained && rows.length === MEMBER_COUNT && rows.every((r) => r.status === "present")) {
        record("VERIFY 2: reconnect syncs all 16, row count exactly 16", "PASS", `${rows.length} rows, all present`);
      } else {
        record(
          "VERIFY 2: reconnect syncs all 16, row count exactly 16",
          drained ? "FAIL" : "UNCERTAIN",
          `drained=${drained}, rows=${rows.length}, statuses=${JSON.stringify([...new Set(rows.map((r) => r.status))])}`,
        );
      }

      await context.close();
    }

    // ============================================================
    // VERIFY 3 — replay the same queue twice. Row count unchanged.
    // Simulates the real risk: flush() succeeds server-side, but the app
    // dies/reloads before the queue entry is deleted, so the identical
    // entry gets sent again on next load.
    // ============================================================
    {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await loginAsCoach(context, BASE, COACH_PHONE);
      await gotoRegister(page, BASE, fixture.sessionId);

      const beforeCount = (await attendanceRows(admin, fixture.sessionId)).length;
      const replayMemberId = fixture.memberIds[0];

      // Inject a duplicate of an already-synced entry directly into
      // IndexedDB (same shape enqueueMark would produce) and flush twice.
      // Flattened deliberately: no nested named function declarations —
      // tsx/esbuild can inject a __name(...) helper call when compiling
      // this file, and page.evaluate serializes the callback's source and
      // re-runs it standalone in the browser, where that helper doesn't
      // exist. A nested `function openDb() {...}` reproduced exactly this
      // (ReferenceError: __name is not defined); inline Promises avoid it.
      await page.evaluate(
        ({ sessionId, memberId }) => {
          // Same schema as lib/offline/idb.ts's open(). Racing the app's
          // own IDB init (it opens on mount, in a useEffect) with a raw
          // open that has no onupgradeneeded handler is exactly how you
          // create the DB empty and get "object store not found" on
          // whichever side loses the race — reproduced this for real.
          // Handling the upgrade here too removes the race regardless of
          // who opens first.
          const db: Promise<IDBDatabase> = new Promise((resolve, reject) => {
            const req = indexedDB.open("aqua-offline", 1);
            req.onupgradeneeded = () => {
              const opened = req.result;
              if (!opened.objectStoreNames.contains("queue")) {
                opened.createObjectStore("queue", { keyPath: "clientId" });
              }
              if (!opened.objectStoreNames.contains("kv")) {
                opened.createObjectStore("kv");
              }
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
          });
          const entry = {
            clientId: crypto.randomUUID(),
            sessionId,
            memberId,
            status: "present",
            savedAt: Date.now(),
            attempts: 0,
          };
          return db.then(
            (opened) =>
              new Promise<void>((resolve, reject) => {
                const t = opened.transaction("queue", "readwrite");
                t.objectStore("queue").put(entry);
                t.oncomplete = () => {
                  opened.close();
                  resolve();
                };
                t.onerror = () => reject(t.error);
              }),
          );
        },
        { sessionId: fixture.sessionId, memberId: replayMemberId },
      );
      await page.evaluate(() => window.__flushQueue?.());
      await page.waitForTimeout(1000);
      await page.evaluate(() => window.__flushQueue?.());
      await page.waitForTimeout(1000);

      const afterCount = (await attendanceRows(admin, fixture.sessionId)).length;
      if (afterCount === beforeCount) {
        record("VERIFY 3: replaying the same queue entry twice", "PASS", `row count unchanged at ${afterCount}`);
      } else {
        record("VERIFY 3: replaying the same queue entry twice", "FAIL", `row count went ${beforeCount} -> ${afterCount}`);
      }

      await context.close();
    }

    // ============================================================
    // VERIFY 4 — mark offline, change the mark offline, reconnect.
    // LAST value wins.
    // ============================================================
    {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const page = await loginAsCoach(context, BASE, COACH_PHONE);
      await gotoRegister(page, BASE, fixture.sessionId);
      const target = fixture.memberIds[1];

      await context.setOffline(true);
      await page.locator(`li[data-member-id="${target}"] button[aria-label="Present"]`).click();
      await page.waitForTimeout(300);
      await page.locator(`li[data-member-id="${target}"] button[aria-label="Absent"]`).click();
      await context.setOffline(false);

      const drained = await waitForQueueDrain(page);
      const rows = await attendanceRows(admin, fixture.sessionId);
      const forTarget = rows.filter((r) => r.memberId === target);

      if (drained && forTarget.length === 1 && forTarget[0].status === "absent") {
        record("VERIFY 4: last value wins after present-then-absent offline", "PASS", `1 row, status=${forTarget[0].status}`);
      } else {
        record(
          "VERIFY 4: last value wins after present-then-absent offline",
          "FAIL",
          `drained=${drained}, rows for member=${JSON.stringify(forTarget)}`,
        );
      }

      await context.close();
    }

    // VERIFY 5 — go offline mid-sync (some marks gone, some not),
    // reconnect. No duplicates, no losses. (scripts/lib/offline-verify.ts)
    await runVerify5(browser, admin, fixture, BASE, COACH_PHONE, record);

    // VERIFY 6 — two devices, one offline, marking the same member.
    // Reconnect. Last write wins, no crossed rows. (scripts/lib/offline-verify.ts)
    await runVerify6(browser, admin, fixture, BASE, COACH_PHONE, record);

    // COLD START — never-visited session, offline: a clear message, not
    // the browser's generic error. (scripts/lib/offline-verify.ts)
    await runVerifyColdStart(browser, fixture, BASE, COACH_PHONE, record);
  } catch (err) {
    console.error("FATAL:", err);
    for (const name of [
      "VERIFY 1", "VERIFY 2", "VERIFY 3", "VERIFY 4", "VERIFY 5", "VERIFY 6", "COLD START",
    ]) {
      if (!results.some((r) => r.name.startsWith(name))) {
        record(name, "UNCERTAIN", `script aborted before this ran: ${(err as Error).message}`);
      }
    }
  } finally {
    if (fixture) await cleanupOfflineFixture(admin, fixture).catch((e) => console.error("cleanup failed:", e));
    await browser.close();
    await admin.end();
    if (server.pid) process.kill(-server.pid!);
  }

  console.log("\n=== SUMMARY ===");
  for (const r of results) console.log(`[${r.result}] ${r.name}`);
  const failed = results.filter((r) => r.result !== "PASS");
  process.exit(failed.length > 0 ? 1 : 0);
}

main();
