import type { BrowserContext, Page } from "playwright";

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
  const page = await context.newPage();
  await page.goto(`${base}/login`);
  await page.getByPlaceholder("+91 98765 43210").fill(coachPhone);
  await page.getByRole("button", { name: "Send code" }).click();
  const hint = page.locator("[data-testid=dev-code]");
  await hint.waitFor({ timeout: 15_000 });
  const code = (await hint.textContent())!.replace(/\D/g, "").slice(-6);
  await page.getByPlaceholder("••••••").fill(code);
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await page.waitForURL("**/coach", { timeout: 15_000 });
  return page;
}

export async function gotoRegister(page: Page, base: string, sessionId: string): Promise<void> {
  await page.goto(`${base}/coach/register/${sessionId}`);
  await page.locator('li button[aria-label="Present"]').first().waitFor({ timeout: 15_000 });
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
    const state = await page.locator('[data-testid="sync-state"]').textContent();
    if (state && /^synced /.test(state.trim())) return true;
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
