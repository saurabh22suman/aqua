#!/usr/bin/env tsx
/**
 * Finance lane — Chrome probe for the empty Reports directory list.
 *
 * 2 November 2026, confirmed in ACTUAL production Chrome by the
 * coordinator's 184-view review: after switching off all five report
 * families through the real Settings controls, the recovery notice appears
 * but the directory list still painted an empty card — a 358x2px bordered
 * box. The recorded computed RED is in the integration review evidence
 * (.playwright-mcp/owner-light-full-review-r1/owner-pages-chrome.json,
 * journey "Hidden report families leave no empty painted container") and
 * state-reports-all-hidden.png.
 *
 * This probe is the durable regression for it. It drives the REAL app:
 *
 *   1. synthetic local login — the real hydrated Sign in button is pressed
 *      (both values re-entered until the button is enabled, exactly as the
 *      coordinator's owner-pages driver does it; the journey is confirmed by
 *      the URL leaving /login);
 *   2. the REAL Settings "Report display" switches are operated, so the
 *      operator's own report-visibility preference is what changes;
 *   3. the Reports page is opened and the recovery notice is awaited;
 *   4. the directory list's COMPUTED paint is read — an empty list must
 *      have no painted box at all (no border, no background, no height),
 *      and a list with rows must still paint. The list is matched as the
 *      Owner page's own content <ul> (inside `owner-content`), which exists
 *      empty or populated and never matches a navigation list;
 *   5. the switches are restored in this isolated browser context.
 *
 * No CSS is injected, no console/page error is suppressed, and the text
 * caret is left as the browser draws it (`caret: "initial"`): a probe that
 * hides the caret changes focus and selection behaviour under test. The
 * installed Playwright (1.62) takes `caret` as a SCREENSHOT option — it is
 * not a browser-context option in this version — so every screenshot this
 * probe takes asks for `caret: "initial"`.
 *
 * The probe is run by the coordinator against the OWNED production preview
 * (the browser stays coordinator-owned):
 *
 *   AQUA_E2E_BASE_URL=http://127.0.0.1:<port> \
 *   AQUA_E2E_OUT=.playwright-mcp/finance-empty-list-probe \
 *   AQUA_E2E_PHONE=+919000000001 AQUA_E2E_PIN=123456 \
 *   pnpm exec tsx tests/owner-light-20261102/finance/reports-empty-list-chrome.ts
 *
 * Exit code 0 means every check passed.
 */
import { chromium, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type Check = { name: string; pass: boolean; detail: string };

const BASE_URL = process.env.AQUA_E2E_BASE_URL ?? "";
const OUT = process.env.AQUA_E2E_OUT ?? ".playwright-mcp/finance-empty-list-probe";
const PHONE = process.env.AQUA_E2E_PHONE ?? "+919000000001";
const PIN = process.env.AQUA_E2E_PIN ?? "123456";
const VIEWPORT = { width: 390, height: 844 };

/** The report families the operator can switch off. */
const FAMILIES = ["Attendance", "Members", "Staff", "Batches", "Collections"] as const;

/** The painted box of an element, read from the browser's own layout. */
async function paintedBox(page: Page, selector: string) {
  return page.locator(selector).first().evaluate((node) => {
    const element = node as HTMLElement;
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    return {
      tag: element.tagName.toLowerCase(),
      display: style.display,
      visibility: style.visibility,
      borderTopWidth: style.borderTopWidth,
      borderTopStyle: style.borderTopStyle,
      backgroundColor: style.backgroundColor,
      width: Math.round(box.width),
      height: Math.round(box.height),
      children: element.children.length,
    };
  });
}

/**
 * The directory list, matched in BOTH states.
 *
 * The list keeps its own <ul> when every family is hidden — it simply has no
 * children — so the selector must not require a child <li>. It is a direct
 * child of the Owner page <main data-owner-page> inside the Owner content
 * region, which excludes the Primary and mobile nav lists (both outside
 * `owner-content`). This is existing markup; no marker was added for the probe.
 */
const DIRECTORY_LIST = '[data-testid="owner-content"] main[data-owner-page] > ul';

/**
 * Synthetic local login on the hydrated client form, exactly as the
 * coordinator's owner-pages driver does it:
 *
 *   - the server HTML ships the form with an empty, disabled submit button;
 *     React binds the state on hydration, and a fill/click before hydration
 *     is lost;
 *   - readiness is the real "Sign in" button becoming ENABLED, and the two
 *     values are re-entered on every attempt because hydration can reset them
 *     (bounded: 35 × 200 ms, as in the driver);
 *   - the enabled button is then clicked, and the journey is confirmed by the
 *     URL leaving /login, not by the click resolving.
 *
 * A failure is returned as a named check detail — never swallowed.
 */
async function signIn(page: Page): Promise<{ ok: boolean; detail: string }> {
  await page.goto(`${BASE_URL}/login`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  const phone = page.locator("#login-phone");
  const pin = page.locator("#login-pin");
  const submit = page.getByRole("button", { name: "Sign in", exact: true });

  for (let attempt = 0; attempt < 35; attempt++) {
    await phone.fill(PHONE);
    await pin.fill(PIN);
    await pin.blur();
    if (await submit.isEnabled()) break;
    await page.waitForTimeout(200);
  }
  if (!(await submit.isEnabled())) {
    return { ok: false, detail: "Synthetic login hydration failed" };
  }

  await submit.click();
  try {
    await page.waitForURL((url) => url.pathname.startsWith("/owner"), {
      timeout: 45_000,
    });
  } catch (error) {
    return {
      ok: false,
      detail: `no /owner navigation after the hydrated click (url ${page.url()}) — ${String(error).slice(0, 200)}`,
    };
  }
  await page.waitForLoadState("networkidle", { timeout: 30_000 });
  return { ok: true, detail: page.url() };
}

async function switchByName(page: Page, name: string) {
  const control = page.getByRole("switch", { name });
  await control.waitFor({ state: "visible" });
  return control;
}

async function runScenario(page: Page): Promise<Check[]> {
  const checks: Check[] = [];

  // 1 — synthetic local login through the REAL hydrated control.
  const signin = await signIn(page);
  checks.push({
    name: "signed-in-with-the-real-hydrated-control",
    pass: signin.ok,
    detail: signin.detail,
  });
  if (!signin.ok) return checks;

  // 2 — the REAL Settings report-display switches. The operator's own
  //     preference is read first, so it can be restored exactly afterwards.
  await page.goto(`${BASE_URL}/owner/settings/reports`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  const initialState: Record<string, boolean> = {};
  for (const family of FAMILIES) {
    const control = await switchByName(page, family);
    const on = (await control.getAttribute("aria-checked")) === "true";
    initialState[family] = on;
    // Only switch off what is currently on; the preference is the operator's own.
    if (on) {
      await control.click();
    }
  }
  checks.push({
    name: "all-report-families-switched-off-through-the-real-controls",
    pass: true,
    detail: FAMILIES.join(", "),
  });

  // 3 — the Reports page, and the recovery notice.
  await page.goto(`${BASE_URL}/owner/reports`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  const recovery = page.getByText("No report cards selected");
  await recovery.waitFor({ state: "visible", timeout: 30_000 });
  checks.push({
    name: "all-hidden-recovery-notice-is-shown",
    pass: true,
    detail: (await recovery.textContent()) ?? "",
  });

  // 4 — the COMPUTED paint of the directory list. This is the regression:
  //     an empty list must not paint a bordered box.
  const empty = await paintedBox(page, DIRECTORY_LIST);
  const emptyPainted =
    empty.display !== "none" &&
    (Number.parseFloat(empty.borderTopWidth) > 0 || empty.height > 0);
  checks.push({
    name: "empty-directory-list-paints-nothing",
    pass: !emptyPainted,
    detail: JSON.stringify(empty),
  });
  await page.screenshot({ path: `${OUT}/empty-list.png`, caret: "initial" });

  // A populated list must still paint: turn one family back on through the
  // real Settings control, then read the list's paint again.
  await page.goto(`${BASE_URL}/owner/settings/reports`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  const attendance = await switchByName(page, "Attendance");
  if ((await attendance.getAttribute("aria-checked")) === "false") {
    await attendance.click();
  }
  await page.goto(`${BASE_URL}/owner/reports`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  const filled = await paintedBox(page, DIRECTORY_LIST);
  checks.push({
    name: "populated-directory-list-still-paints",
    pass: filled.display !== "none" && filled.height > 0,
    detail: JSON.stringify(filled),
  });
  await page.screenshot({ path: `${OUT}/populated-list.png`, caret: "initial" });

  // 5 — restore every switch in this isolated context.
  await page.goto(`${BASE_URL}/owner/settings/reports`, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  for (const family of FAMILIES) {
    const control = await switchByName(page, family);
    // Restore the operator's OWN recorded state, not a blanket "all on".
    const wantsOn = initialState[family] ?? true;
    const isOn = (await control.getAttribute("aria-checked")) === "true";
    if (isOn !== wantsOn) {
      await control.click();
    }
  }
  checks.push({
    name: "report-display-switches-restored",
    pass: true,
    detail: FAMILIES.map(
      (family) => `${family}=${initialState[family] ? "on" : "off"}`,
    ).join(", "),
  });

  return checks;
}

async function main(): Promise<number> {
  if (!BASE_URL) throw new Error("AQUA_E2E_BASE_URL must name the preview.");
  mkdirSync(OUT, { recursive: true });

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const consoleErrors: string[] = [];
  let checks: Check[] = [];
  try {
    const context = await browser.newContext({
      viewport: VIEWPORT,
      locale: "en-IN",
      timezoneId: "Asia/Kolkata",
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    // Nothing is suppressed: a console error or a page error fails the run.
    page.on("console", (message) => {
      if (message.type() === "error") {
        consoleErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => {
      consoleErrors.push(String(error));
    });
    try {
      checks = await runScenario(page);
    } catch (error) {
      checks = [
        {
          name: "scenario-completed",
          pass: false,
          detail: String(error).slice(0, 800),
        },
      ];
      await page.screenshot({ path: `${OUT}/failure.png`, caret: "initial" });
    }
    await context.close();
  } finally {
    await browser.close();
  }

  if (consoleErrors.length) {
    checks.push({
      name: "no-console-or-page-error",
      pass: false,
      detail: consoleErrors.slice(0, 5).join(" | "),
    });
  } else {
    checks.push({
      name: "no-console-or-page-error",
      pass: true,
      detail: "none",
    });
  }

  const failures = checks.filter((check) => !check.pass);
  writeFileSync(
    resolve(process.cwd(), `${OUT}/empty-list-probe.json`),
    `${JSON.stringify(
      {
        at: new Date().toISOString(),
        baseUrl: BASE_URL,
        viewport: VIEWPORT,
        mode: "synthetic local login, real report-display switches, computed paint",
        visualAcceptance: "PENDING",
        checks,
      },
      null,
      2,
    )}\n`,
  );
  console.log(JSON.stringify({ checks: checks.length, failures }, null, 2));
  return failures.length ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(String(error));
    process.exit(1);
  },
);
