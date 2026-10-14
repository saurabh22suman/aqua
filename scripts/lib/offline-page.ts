import type { BrowserContext, Page } from "playwright";
import { DEMO_PIN } from "./demo-credentials";

export async function waitForServer(base: string): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${base}/login`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("dev server never came up");
}

export async function loginAsCoach(
  context: BrowserContext,
  base: string,
  coachPhone: string,
): Promise<Page> {
  // 2026-09-11 auth feature: the login UI is phone + PIN. `pnpm seed`
  // (which the CI job runs before this) sets every login user's
  // credential to DEMO_PIN.
  const page = await context.newPage();
  await page.goto(`${base}/login`);
  await page.waitForLoadState("networkidle");
  await page.getByPlaceholder("+91 98765 43210").fill(coachPhone);
  await page.getByLabel("PIN").fill(DEMO_PIN);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/coach", { timeout: 60_000 });
  return page;
}

export async function gotoRegister(page: Page, base: string, sessionId: string): Promise<void> {
  const url = `${base}/coach/register/${sessionId}`;
  await page.goto(url);
  await page.locator('li button[aria-label="Present"]').first().waitFor({ timeout: 60_000 });
  if (await page.evaluate(() => navigator.onLine)) {
    await page.waitForLoadState("networkidle");
    const state = await page.evaluate(async () => (await fetch("/api/offline/session")).json());
    if (state.identity) await waitForOfflineCopy(page, url, state.identity.scope);
  }
}

export async function waitForOfflineCopy(page: Page, url: string, scope: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const ready = await page.evaluate(async ({ url, scope }) => {
      if (!navigator.serviceWorker.controller) return false;
      const meta = await (await caches.open("aqua-offline-state-v2")).match(new URL("/__aqua_offline_state", location.origin).href);
      if (!meta || (await meta.json()).identity?.scope !== scope) return false;
      return Boolean(await (await caches.open(`aqua-private-v2-${scope}`)).match(url, { ignoreVary: true }));
    }, { url, scope });
    if (ready) return;
    await page.waitForTimeout(100);
  }
  const diagnostics = await page.evaluate(async ({ url, scope }) => {
    const response = await (await caches.open("aqua-offline-state-v2")).match(new URL("/__aqua_offline_state", location.origin).href);
    const keys = await (await caches.open(`aqua-private-v2-${scope}`)).keys();
    return { url, scope, controlled: Boolean(navigator.serviceWorker.controller), meta: response ? await response.json() : null,
      registrations: (await navigator.serviceWorker.getRegistrations()).map(registration => ({ scope: registration.scope,
        active: registration.active?.state, script: registration.active?.scriptURL })),
      cachedUrls: keys.map(key => key.url) };
  }, { url, scope });
  throw new Error(`The authenticated offline document was not fully downloaded: ${JSON.stringify(diagnostics)}`);
}

export async function markAll(
  page: Page,
  memberIds: string[],
  status: "Present" | "Absent",
): Promise<void> {
  for (const id of memberIds) {
    await page.locator(`li[data-member-id="${id}"] button[aria-label="${status}"]`).click();
  }
}

export async function domStatuses(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const out: Record<string, string> = {};
    for (const li of Array.from(document.querySelectorAll("li[data-member-id]"))) {
      const id = li.getAttribute("data-member-id")!;
      out[id] = li.getAttribute("data-status") ?? "";
    }
    return out;
  });
}

// issue #4, mechanism 3: markAll() clicks fire mark() without awaiting it
// (the real onClick shape — a click handler can't block navigation). A
// reload immediately after clicking races whatever local writes haven't
// committed yet. This waits on the hook's own settlement signal instead
// of a guessed sleep — deterministic in the same sense waitForQueueDrain
// is: it's polling a real, product-owned promise, not padding time.
export async function waitForPendingWrites(page: Page): Promise<void> {
  await page.evaluate(() => window.__waitForPendingWrites?.());
}

// Kill switch off: mark() reaches the DOM only after the server
// confirms, and the onClick handler doesn't await it — so a script
// clicking and immediately reading domStatuses would race the real
// network round trip. This polls the one row's actual attribute
// instead of guessing a sleep long enough to cover it.
export async function waitForMemberStatus(
  page: Page,
  memberId: string,
  status: string,
  timeoutMs = 10_000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const current = await page
      .locator(`li[data-member-id="${memberId}"]`)
      .getAttribute("data-status");
    if (current === status) return true;
    await page.waitForTimeout(200);
  }
  return false;
}

export async function waitForQueueDrain(page: Page, timeoutMs = 20_000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // Copy-independent probe: the visible label is UX copy (it changed
    // from "synced HH:MM" to "Saved at HH:MM" in the mobile pass); the
    // data-sync-state attribute is the stable contract.
    const state = await page
      .locator('[data-testid="sync-state"]')
      .getAttribute("data-sync-state");
    if (state === "synced") return true;
    await page.evaluate(() => window.__flushQueue?.());
    await page.waitForTimeout(500);
  }
  return false;
}

export type VerifyResult = "PASS" | "FAIL" | "UNCERTAIN";

export function makeRecorder() {
  const results: { name: string; result: VerifyResult; detail: string }[] = [];
  function record(name: string, result: VerifyResult, detail: string) {
    results.push({ name, result, detail });
    console.log(`[${result}] ${name} — ${detail}`);
  }
  return { results, record };
}
