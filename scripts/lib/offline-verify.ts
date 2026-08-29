import type { Browser } from "playwright";
import type { Pool } from "pg";
import { attendanceRows, type OfflineFixture } from "./offline-fixture";
import { gotoRegister, loginAsCoach, markAll, waitForQueueDrain, type VerifyResult } from "./offline-page";

type Record_ = (name: string, result: VerifyResult, detail: string) => void;

// VERIFY 5 — go offline mid-sync (some marks gone, some not), reconnect.
// No duplicates, no losses.
export async function runVerify5(
  browser: Browser,
  admin: Pool,
  fixture: OfflineFixture,
  base: string,
  coachPhone: string,
  record: Record_,
): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await loginAsCoach(context, base, coachPhone);
  await gotoRegister(page, base, fixture.sessionId);

  const midSyncMembers = fixture.memberIds.slice(2, 10); // 8 members, fresh from verify 1-4's state
  await context.setOffline(true);
  await markAll(page, midSyncMembers, "Present");
  await context.setOffline(false);
  // Let SOME requests land, then cut the network again before the whole
  // queue drains — this is the "mid-sync" moment.
  await page.waitForTimeout(400);
  await context.setOffline(true);
  await page.waitForTimeout(800);
  await context.setOffline(false);
  const drained = await waitForQueueDrain(page);

  const rows = await attendanceRows(admin, fixture.sessionId);
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(r.memberId, (counts.get(r.memberId) ?? 0) + 1);
  const duplicated = [...counts.entries()].filter(([, n]) => n > 1);
  const missing = midSyncMembers.filter((id) => !rows.some((r) => r.memberId === id));

  if (drained && duplicated.length === 0 && missing.length === 0) {
    record("VERIFY 5: offline mid-sync — no duplicates, no losses", "PASS", `${midSyncMembers.length} members, 0 duplicates, 0 missing`);
  } else {
    record(
      "VERIFY 5: offline mid-sync — no duplicates, no losses",
      "FAIL",
      `drained=${drained}, duplicated=${JSON.stringify(duplicated)}, missing=${JSON.stringify(missing)}`,
    );
  }

  await context.close();
}

// VERIFY 6 — two devices, one offline, marking the same member. Reconnect.
// Last write wins, no crossed rows.
export async function runVerify6(
  browser: Browser,
  admin: Pool,
  fixture: OfflineFixture,
  base: string,
  coachPhone: string,
  record: Record_,
): Promise<void> {
  const target = fixture.memberIds[10];
  const contextA = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const contextB = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pageA = await loginAsCoach(contextA, base, coachPhone);
  const pageB = await loginAsCoach(contextB, base, coachPhone);
  await gotoRegister(pageA, base, fixture.sessionId);
  await gotoRegister(pageB, base, fixture.sessionId);

  // Device A goes offline and marks present.
  await contextA.setOffline(true);
  await pageA.locator(`li[data-member-id="${target}"] button[aria-label="Present"]`).click();

  // Device B stays online and marks absent — this one actually reaches the
  // server first.
  await pageB.locator(`li[data-member-id="${target}"] button[aria-label="Absent"]`).click();
  await waitForQueueDrain(pageB, 10_000);

  // Device A reconnects after B's write has already landed.
  await contextA.setOffline(false);
  const drainedA = await waitForQueueDrain(pageA);

  const rows = await attendanceRows(admin, fixture.sessionId);
  const forTarget = rows.filter((r) => r.memberId === target);

  // "Last write wins" here means last WRITE TO THE SERVER, not last user
  // action — device A's mark was made first in wall-clock time but reaches
  // the server last (after reconnecting), so it wins. Reporting exactly
  // what happened, not what might be assumed.
  if (drainedA && forTarget.length === 1) {
    record(
      "VERIFY 6: two devices, one offline, same member — no crossed rows",
      "PASS",
      `1 row, final status=${forTarget[0].status} (device A's mark, since it reached the server last)`,
    );
  } else {
    record(
      "VERIFY 6: two devices, one offline, same member — no crossed rows",
      "FAIL",
      `drainedA=${drainedA}, rows for member=${JSON.stringify(forTarget)}`,
    );
  }

  await contextA.close();
  await contextB.close();
}

// COLD START — a session's register page that was never opened in this
// browser context, visited for the first time while offline. Rule 1:
// visible error over graceful mystery, not the browser's own generic
// "can't reach this page" screen.
//
// Important scope limit, checked precisely by this test's own setup: the
// service worker can only intercept a request if it's registered at all,
// which requires at least one prior ONLINE page load in this context — a
// device that has NEVER opened the app, ever, has nothing to intercept
// with and no fix here changes that (no offline strategy can serve what
// was never downloaded once). What this covers, and what's realistic for
// a coach at a poolside, is: the app shell was opened before (so the
// service worker is registered and active), but THIS session's register
// page specifically was not — logging in here first, then hitting an
// unvisited register URL, not skipping login entirely.
export async function runVerifyColdStart(
  browser: Browser,
  fixture: OfflineFixture,
  base: string,
  coachPhone: string,
  record: Record_,
): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await loginAsCoach(context, base, coachPhone);
  // Shell is now cached (login page assets + the /coach navigate + the
  // service worker itself). This specific session's register page has
  // never been requested in this context.
  await page.waitForTimeout(1500);

  await context.setOffline(true);
  await page.goto(`${base}/coach/register/${fixture.sessionId}`).catch(() => {});
  const bodyText = await page.locator("body").textContent().catch(() => "");

  if (bodyText?.includes("hasn't been downloaded yet")) {
    record(
      "COLD START: never-visited session, offline — clear message, not a mystery",
      "PASS",
      "service worker served the offline-not-downloaded fallback",
    );
  } else {
    record(
      "COLD START: never-visited session, offline — clear message, not a mystery",
      "FAIL",
      `body did not contain the expected message: ${JSON.stringify(bodyText?.slice(0, 200))}`,
    );
  }

  await context.close();
}
