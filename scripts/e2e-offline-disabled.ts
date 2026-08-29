import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { Pool } from "pg";
import { env } from "@/lib/env";
import {
  attendanceRows,
  cleanupOfflineFixture,
  setOfflineSyncEnabled,
  setupOfflineFixture,
  type OfflineFixture,
} from "./lib/offline-fixture";
import {
  gotoRegister,
  loginAsCoach,
  makeRecorder,
  waitForMemberStatus,
  waitForServer,
} from "./lib/offline-page";

// The counterpart to e2e-offline.ts: this is the default state every
// tenant ships in (offline_sync_enabled = false, issue #4 postmortem's
// kill switch). Confirms the online happy path is unaffected, the
// offline banner is proactive (appears the instant connectivity drops,
// not only after a failed tap), and a tap made while offline is
// refused outright — no DOM update, no DB row — never silently queued.
const BASE = "http://localhost:3216";
const MEMBER_COUNT = 2;
const RUN = Date.now().toString(36);
const COACH_PHONE = "+91 90000 00002";

const { results, record } = makeRecorder();

async function main() {
  const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
  const server = spawn("pnpm", ["next", "dev", "-p", "3216"], {
    stdio: "ignore",
    detached: true,
  });

  let fixture: OfflineFixture | undefined;
  const browser = await chromium.launch();

  try {
    await waitForServer(BASE);
    fixture = await setupOfflineFixture(admin, RUN, MEMBER_COUNT);
    await setOfflineSyncEnabled(admin, fixture.tenantId, false);
    console.log(`fixture ready (flag OFF) — session ${fixture.sessionId}, ${fixture.memberIds.length} members`);

    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await loginAsCoach(context, BASE, COACH_PHONE);
    await gotoRegister(page, BASE, fixture.sessionId);

    // ============================================================
    // VERIFY A — online happy path: marking still works, lands on the
    // server, exactly as before the flag existed.
    // ============================================================
    const onlineMember = fixture.memberIds[0];
    await page.locator(`li[data-member-id="${onlineMember}"] button[aria-label="Present"]`).click();
    const markedOnline = await waitForMemberStatus(page, onlineMember, "present");
    const onlineRows = await attendanceRows(admin, fixture.sessionId);
    const onlineRowExists = onlineRows.some((r) => r.memberId === onlineMember && r.status === "present");

    if (markedOnline && onlineRowExists) {
      record("VERIFY A: online happy path still marks and persists", "PASS", "DOM shows present, row exists");
    } else {
      record(
        "VERIFY A: online happy path still marks and persists",
        "FAIL",
        `DOM present=${markedOnline}, server row exists=${onlineRowExists}`,
      );
    }

    // ============================================================
    // VERIFY B — the offline banner is proactive: appears the instant
    // connectivity drops, before any tap is attempted.
    // ============================================================
    await context.setOffline(true);
    const banner = page.locator('[data-testid="offline-banner"]');
    let bannerAppeared = false;
    try {
      await banner.waitFor({ state: "visible", timeout: 5_000 });
      bannerAppeared = true;
    } catch {
      bannerAppeared = false;
    }

    if (bannerAppeared) {
      record("VERIFY B: offline banner appears proactively on disconnect", "PASS", "visible without any tap");
    } else {
      record("VERIFY B: offline banner appears proactively on disconnect", "FAIL", "banner never appeared");
    }

    // ============================================================
    // VERIFY C — a tap made while offline is refused: no DOM update,
    // no DB row. Never silently queued.
    // ============================================================
    const offlineMember = fixture.memberIds[1];
    await page.locator(`li[data-member-id="${offlineMember}"] button[aria-label="Present"]`).click();
    await page.waitForTimeout(1_500);
    const domAfterOfflineTap = await page
      .locator(`li[data-member-id="${offlineMember}"]`)
      .getAttribute("data-status");
    const rowsAfterOfflineTap = await attendanceRows(admin, fixture.sessionId);
    const offlineRowExists = rowsAfterOfflineTap.some((r) => r.memberId === offlineMember);

    if (domAfterOfflineTap !== "present" && !offlineRowExists) {
      record(
        "VERIFY C: a tap while offline is refused, not silently accepted",
        "PASS",
        `DOM status=${JSON.stringify(domAfterOfflineTap)}, no server row`,
      );
    } else {
      record(
        "VERIFY C: a tap while offline is refused, not silently accepted",
        "FAIL",
        `DOM status=${JSON.stringify(domAfterOfflineTap)}, row exists=${offlineRowExists}`,
      );
    }

    await context.setOffline(false);
    await context.close();
  } catch (err) {
    console.error("FATAL:", err);
    for (const name of ["VERIFY A", "VERIFY B", "VERIFY C"]) {
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

  console.log("\n=== SUMMARY (disabled) ===");
  for (const r of results) console.log(`[${r.result}] ${r.name}`);
  const failed = results.filter((r) => r.result !== "PASS");
  process.exit(failed.length > 0 ? 1 : 0);
}

main();
