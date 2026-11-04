#!/usr/bin/env tsx
/**
 * Reviewer-owned, read-only Staff picker Chrome check.
 *
 * Invoke only through lane_job.py + owner_preview.py without the production
 * flag for an honest scoped dev check. This is deliberately a scoped QA
 * check, not a source seal, build gate or full Owner acceptance.
 * This script never saves/creates staff, never sends a payment/message/settings
 * action and never reads the database directly.
 *
 *   AQUA_E2E_OUT=.playwright-mcp/staff-picker-chrome \
 *   node --experimental-strip-types \
 *     tests/owner-openpen-20261029/reviewer/staff-picker-chrome.ts
 *
 * It reads the first synthetic member row from /owner/members, opens
 * /owner/staff/new -> Existing person, searches that exact DOM name, selects
 * the real candidate, verifies the identity preview/change state, then
 * searches a nonsense value and requires the honest empty state.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";

const ROOT = process.cwd();
const BASE_URL = process.env.AQUA_E2E_BASE_URL ?? "http://127.0.0.1:3275";
const OUT_DIR = resolve(ROOT, process.env.AQUA_E2E_OUT ?? ".playwright-mcp/staff-picker-chrome");
if (!relative(ROOT, OUT_DIR).startsWith(".playwright-mcp")) {
  throw new Error("Staff picker evidence must stay under ignored .playwright-mcp/");
}
const PHONE = process.env.AQUA_E2E_PHONE ?? "+919000000001";
const PIN = process.env.AQUA_E2E_PIN ?? "123456";
const THEMES = ["mint", "lavender"] as const;
const VIEWPORTS = [
  { name: "mobile-390x844", width: 390, height: 844 },
  { name: "desktop-1280x900", width: 1280, height: 900 },
] as const;
const BUDGET_MS = 180_000;
const SOURCE_FILES = [
  "app/(owner)/owner/staff/new/page.tsx",
  "components/staff-create-form.tsx",
  "components/staff-person-picker.tsx",
  "lib/services/staff-candidates.ts",
  "lib/auth/permission.ts",
  "lib/auth/action-permissions.ts",
  "lib/actions/staff.ts",
  "db/seed-platform.ts",
];

type Theme = (typeof THEMES)[number];
type Check = { name: string; pass: boolean | null; detail: string };
type RunRecord = {
  theme: Theme;
  viewport: string;
  route: string;
  status: "CAPTURED" | "CHANGES REQUIRED" | "UNTESTED" | "BLOCKED";
  captured: boolean;
  tested: string[];
  visualReviewed: false;
  visualVerdict: "PENDING";
  screenshots: string[];
  checks: Check[];
  defects: string[];
  unavailable: string[];
  member?: { name: string; phone: string };
  searchInput?: { width: number; height: number; fontSize: number; radius: string };
  candidate?: { text: string; width: number; height: number };
};

const records: RunRecord[] = [];

function normPhone(value: string): string {
  return value.replace(/\D/g, "");
}

async function sourceHashes(): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const file of SOURCE_FILES) {
    try {
      out[file] = createHash("sha256")
        .update(await readFile(join(ROOT, file)))
        .digest("hex");
    } catch {
      out[file] = null;
    }
  }
  return out;
}

async function signIn(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    const submit = page.locator("form button[type=submit]");
    for (let attempt = 0; attempt < 8; attempt++) {
      await page.fill("#login-phone", PHONE);
      await page.fill("#login-pin", PIN);
      const ready = await page.evaluate(() => {
        const button = document.querySelector('form button[type="submit"]') as HTMLButtonElement | null;
        return Boolean(button && !button.disabled);
      });
      if (ready) {
        await Promise.all([
          page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 }),
          submit.click(),
        ]);
        return;
      }
      await page.waitForTimeout(250);
    }
    throw new Error("synthetic sign-in did not become ready");
  } finally {
    await page.close().catch(() => {});
  }
}

async function readFirstMember(page: Page): Promise<{ name: string; phone: string }> {
  await page.goto(`${BASE_URL}/owner/members`, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.locator('[data-testid="members-list"]').waitFor({ state: "visible", timeout: 30_000 });
  const row = page.locator('[data-testid="member-row"]').first();
  await row.waitFor({ state: "visible", timeout: 15_000 });
  const rawName = (await row.locator('[data-testid="member-row-name"]').innerText())
    .replace(/\s+/g, " ")
    .trim();
  const name = rawName.replace(/\s*\(minor\)\s*$/i, "").trim();
  const phone = (await row.locator('[data-testid="member-row-phone"]').innerText()).replace(/\s+/g, " ").trim();
  if (!name) throw new Error("first member row has no rendered name");
  return { name, phone };
}

async function findSearchInput(page: Page) {
  // Exact StaffPersonPicker input only. The OwnerShell header also contains a
  // search input, so a generic main/type=search fallback is forbidden here.
  const byId = page.locator("#staff-person-query").first();
  if ((await byId.count()) > 0 && (await byId.isVisible().catch(() => false))) {
    return byId;
  }
  const byRole = page.getByRole("searchbox", {
    name: "Find a person by name or phone",
    exact: true,
  });
  if (
    (await byRole.count()) > 0 &&
    (await byRole.isVisible().catch(() => false))
  ) {
    return byRole.first();
  }
  return null;
}

async function waitForStaffCandidate(
  page: Page,
  name: string,
): Promise<{ locator: Locator; text: string; width: number; height: number } | null> {
  // The known StaffPersonPicker result list: main ul > li > button. Do not
  // fall back to arbitrary li/button widgets elsewhere on the page.
  const locator = page.locator("main ul button").filter({ hasText: name }).first();
  const visible = await locator
    .waitFor({ state: "visible", timeout: 15_000 })
    .then(() => true)
    .catch(() => false);
  if (!visible) return null;
  const box = await locator.boundingBox();
  return {
    locator,
    text: (await locator.innerText()).replace(/\s+/g, " ").trim().slice(0, 300),
    width: Math.round(box?.width ?? 0),
    height: Math.round(box?.height ?? 0),
  };
}

async function saveState(page: Page): Promise<boolean | null> {
  const save = page
    .locator('[data-testid="staff-save"], button:has-text("Add staff record")')
    .first();
  if ((await save.count()) === 0 || !(await save.isVisible().catch(() => false))) return null;
  return !(await save.isDisabled());
}

async function fillValidDate(page: Page): Promise<boolean | null> {
  const date = page.locator('[data-testid="staff-employedOn"]').first();
  if ((await date.count()) === 0 || !(await date.isVisible().catch(() => false))) return null;
  const current = await date.inputValue().catch(() => "");
  if (!current) {
    try {
      await date.fill("10/10/2026");
    } catch {
      await date.fill("2026-10-10").catch(() => {});
    }
    await date.blur().catch(() => {});
    await page.waitForTimeout(200);
  }
  return true;
}

async function captureRun(
  browser: Browser,
  theme: Theme,
  viewport: (typeof VIEWPORTS)[number],
): Promise<RunRecord> {
  const record: RunRecord = {
    theme,
    viewport: viewport.name,
    route: "/owner/staff/new",
    status: "UNTESTED",
    captured: false,
    tested: [],
    visualReviewed: false,
    visualVerdict: "PENDING",
    screenshots: [],
    checks: [],
    defects: [],
    unavailable: [],
  };
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    colorScheme: "light",
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    acceptDownloads: false,
  });
  const add = (name: string, pass: boolean | null, detail: string) =>
    record.checks.push({ name, pass, detail });
  try {
    await signIn(context);
    await context.addCookies([{ name: "aqua_theme", value: theme, url: BASE_URL }]);
    const page = await context.newPage();
    try {
      const member = await readFirstMember(page);
      record.member = member;
      await page.goto(`${BASE_URL}/owner/staff/new`, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      await page.locator('[data-testid="owner-shell"]').waitFor({ state: "visible", timeout: 30_000 });
      const renderedTheme = await page.evaluate(
        () => document.documentElement.dataset.theme ?? "",
      );
      add(
        "theme-applied",
        renderedTheme === theme,
        `requested=${theme}; rendered=${renderedTheme || "none"}`,
      );
      const existingButton = page.getByRole("button", {
        name: "Existing person",
        exact: true,
      });
      if ((await existingButton.count()) > 0) {
        await existingButton.first().click();
      } else {
        await page.getByText("Existing person", { exact: true }).first().click();
      }
      await page.waitForTimeout(250);

      const saveBefore = await saveState(page);
      add(
        "save-disabled-before-selection",
        saveBefore === null ? null : saveBefore === false,
        saveBefore === null ? "save control not rendered" : `enabled=${saveBefore}`,
      );

      const search = await findSearchInput(page);
      if (!search) {
        record.unavailable.push("staff picker search input not rendered");
        await mkdir(dirname(join(OUT_DIR, "staff-picker", theme, viewport.name, "unavailable.png")), {
          recursive: true,
        });
        const unavailable = join(OUT_DIR, "staff-picker", theme, viewport.name, "unavailable.png");
        await page.screenshot({ path: unavailable, fullPage: false, animations: "disabled", caret: "hide" });
        record.screenshots.push(relative(ROOT, unavailable));
        record.status = "UNTESTED";
        return record;
      }

      const searchMetrics = await search.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          width: Math.round(box.width),
          height: Math.round(box.height),
          fontSize: parseFloat(style.fontSize) || 0,
          radius: style.borderTopLeftRadius,
        };
      });
      record.searchInput = searchMetrics;
      add(
        "search-input-16px-48px-10px",
        searchMetrics.fontSize === 16 &&
          Math.abs(searchMetrics.height - 48) <= 0.5 &&
          searchMetrics.radius === "10px",
        `${searchMetrics.width}x${searchMetrics.height}; font=${searchMetrics.fontSize}; radius=${searchMetrics.radius}`,
      );
      add(
        "no-horizontal-overflow",
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
              document.documentElement.clientWidth <=
            0,
        ),
        `overflow=${await page.evaluate(
          () =>
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        )}px`,
      );

      await search.fill(member.name);
      await page.waitForTimeout(500);
      const candidate = await waitForStaffCandidate(page, member.name);
      if (!candidate) {
        add("real-candidate-rendered", false, `no candidate for exact name="${member.name}"`);
        const missingShot = join(
          OUT_DIR,
          "staff-picker",
          theme,
          viewport.name,
          "search-result.png",
        );
        await mkdir(dirname(missingShot), { recursive: true });
        await page.screenshot({ path: missingShot, fullPage: false, animations: "disabled", caret: "hide" });
        record.screenshots.push(relative(ROOT, missingShot));
        record.defects = record.checks.filter((check) => check.pass === false).map(
          (check) => `${check.name}: ${check.detail}`,
        );
        record.status = "CHANGES REQUIRED";
        return record;
      }
      record.candidate = candidate;
      add(
        "candidate-target-at-least-44x44",
        candidate.width >= 44 && candidate.height >= 44,
        `${candidate.width}x${candidate.height}`,
      );
      const resultShot = join(
        OUT_DIR,
        "staff-picker",
        theme,
        viewport.name,
        "search-result.png",
      );
      await mkdir(dirname(resultShot), { recursive: true });
      await page.screenshot({ path: resultShot, fullPage: false, animations: "disabled", caret: "hide" });
      record.screenshots.push(relative(ROOT, resultShot));

      const candidateLocator = candidate.locator;
      await candidateLocator.click();
      await page.waitForTimeout(500);
      const preview = page.locator('[data-testid="staff-person-preview"]').first();
      await preview.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
      const previewVisible = await preview.isVisible().catch(() => false);
      const previewText = previewVisible ? await preview.innerText() : "";
      const change = preview.getByRole("button", {
        name: "Change person",
        exact: true,
      });
      const changeVisible =
        previewVisible &&
        (await change.count()) > 0 &&
        (await change.isVisible().catch(() => false));
      add(
        "identity-preview-and-change",
        previewVisible &&
          previewText.includes(member.name) &&
          changeVisible,
        `preview=${previewVisible}; nameInPreview=${previewText.includes(member.name)}; change=${changeVisible}`,
      );
      const phoneDigits = normPhone(member.phone);
      const phoneDisplay = member.phone
        .replace(/^\s*Phone\s*/i, "")
        .replace(/\s+/g, " ")
        .trim();
      const phoneUsable =
        normPhone(phoneDisplay).length >= 6 &&
        phoneDisplay.length > 0 &&
        !/^(—|–|-|no phone.*)$/i.test(phoneDisplay);
      add(
        "same-identity-phone",
        phoneDigits.length < 6
          ? null
          : candidate.text.replace(/\s+/g, "").includes(phoneDigits) ||
              previewText.replace(/\s+/g, "").includes(phoneDigits),
        phoneDigits.length < 6
          ? "member row has no usable formatted phone"
          : `row="${member.phone}"; candidate=${candidate.text}`,
      );

      const dateFilled = await fillValidDate(page);
      const saveAfter = await saveState(page);
      add(
        "selection-enables-save-if-date-valid",
        saveAfter === null ? null : saveAfter === true,
        `date=${dateFilled === null ? "not rendered (optional)" : "valid"}; enabled=${saveAfter}`,
      );

      const selectedShot = join(
        OUT_DIR,
        "staff-picker",
        theme,
        viewport.name,
        "selected.png",
      );
      await page.screenshot({ path: selectedShot, fullPage: false, animations: "disabled", caret: "hide" });
      record.screenshots.push(relative(ROOT, selectedShot));

      if (changeVisible) await change.click();
      await page.waitForTimeout(250);
      const emptySearch = await findSearchInput(page);
      if (!emptySearch) {
        add("empty-search-available-after-change", false, "search input did not return after Change");
      } else {
        if (!phoneUsable) {
          add(
            "formatted-phone-search-same-identity",
            null,
            "member row has no usable formatted phone display",
          );
        } else {
          await emptySearch.fill(phoneDisplay);
          await page.waitForTimeout(600);
          const phoneCandidate = await waitForStaffCandidate(page, member.name);
          add(
            "formatted-phone-search-same-identity",
            phoneCandidate !== null &&
              phoneCandidate.text.includes(member.name) &&
              normPhone(phoneCandidate.text).includes(phoneDigits),
            phoneCandidate
              ? `query="${phoneDisplay}"; candidate=${phoneCandidate.text}`
              : `query="${phoneDisplay}"; no same-identity candidate`,
          );
          if (phoneCandidate) {
            const phoneShot = join(
              OUT_DIR,
              "staff-picker",
              theme,
              viewport.name,
              "phone-search.png",
            );
            await mkdir(dirname(phoneShot), { recursive: true });
            await page.screenshot({ path: phoneShot, fullPage: false, animations: "disabled", caret: "hide" });
            record.screenshots.push(relative(ROOT, phoneShot));
          }
        }
        await emptySearch.fill("__aqua_no_such_staff_2026__");
        await page.waitForTimeout(500);
        const empty = page
          .getByText(/No matching person|no (matches|people|results)|nothing found/i)
          .first();
        const emptyVisible = await empty
          .waitFor({ state: "visible", timeout: 10_000 })
          .then(() => true)
          .catch(() => false);
        add(
          "honest-empty-after-nonsense",
          emptyVisible,
          emptyVisible ? "honest empty state rendered" : "no honest empty state found",
        );
      }
      const emptyShot = join(
        OUT_DIR,
        "staff-picker",
        theme,
        viewport.name,
        "empty.png",
      );
      await mkdir(dirname(emptyShot), { recursive: true });
      await page.screenshot({ path: emptyShot, fullPage: false, animations: "disabled", caret: "hide" });
      record.screenshots.push(relative(ROOT, emptyShot));

      record.captured = true;
      record.tested = record.checks.filter((check) => check.pass !== null).map((check) => check.name);
      record.defects = record.checks
        .filter((check) => check.pass === false)
        .map((check) => `${check.name}: ${check.detail}`);
      record.unavailable = record.checks
        .filter((check) => check.pass === null)
        .map((check) => check.name);
      record.status = record.defects.length ? "CHANGES REQUIRED" : "CAPTURED";
      return record;
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    await context.close().catch(() => {});
  }
}

const started = Date.now();
let browser: Browser | null = null;
let fatal: string | null = null;
let budgetTimer: ReturnType<typeof setTimeout> | null = null;
let runPromise: Promise<void> | null = null;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const run = async () => {
    for (const theme of THEMES) {
      for (const viewport of VIEWPORTS) {
        try {
          records.push(await captureRun(browser!, theme, viewport));
        } catch (error) {
          records.push({
            theme,
            viewport: viewport.name,
            route: "/owner/staff/new",
            status: "BLOCKED",
            captured: false,
            tested: [],
            visualReviewed: false,
            visualVerdict: "PENDING",
            screenshots: [],
            checks: [],
            defects: [String(error).slice(0, 700)],
            unavailable: [],
          });
        }
      }
    }
  };
  const budget = new Promise<never>((_, reject) => {
    budgetTimer = setTimeout(
      () => reject(new Error(`script exceeded ${BUDGET_MS}ms budget`)),
      BUDGET_MS,
    );
  });
  runPromise = run();
  await Promise.race([runPromise, budget]);
} catch (error) {
  fatal = String(error).slice(0, 1200);
} finally {
  if (budgetTimer) clearTimeout(budgetTimer);
  if (browser) await browser.close().catch(() => {});
  if (runPromise) await runPromise.catch(() => {});
}

const summary = {
  driver: "staff-picker-chrome",
  startedAt: new Date(started).toISOString(),
  durationMs: Date.now() - started,
  baseUrl: BASE_URL,
  sourceHashes: await sourceHashes(),
  themes: THEMES,
  viewports: VIEWPORTS.map((viewport) => viewport.name),
  records,
  summary: {
    records: records.length,
    captured: records.filter((record) => record.captured).length,
    changesRequired: records.filter((record) => record.status === "CHANGES REQUIRED").length,
    blocked: records.filter((record) => record.status === "BLOCKED").length,
    untested: records.filter((record) => record.status === "UNTESTED").length,
    visualReviewed: 0,
    visualPending: records.length,
  },
  fatal,
  notes: [
    "Read-only staff picker evidence; no staff create/save, payment, message, settings or credential operation.",
    "The first member name/phone comes from the rendered Members DOM, not a direct database read.",
    "No candidate or success response is intercepted or fabricated.",
    "This is scoped evidence, not a current-production source seal or full Owner acceptance.",
  ],
};

await mkdir(OUT_DIR, { recursive: true });
await writeFile(join(OUT_DIR, "summary-staff-picker.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(
  `staff picker: ${summary.summary.captured}/${summary.summary.records} captured; ` +
    `${summary.summary.changesRequired} CHANGES REQUIRED; ${summary.summary.blocked} BLOCKED; ` +
    `${summary.summary.untested} UNTESTED; ${summary.durationMs}ms`,
);
if (fatal) {
  console.error(`STAFF PICKER STOP: ${fatal}`);
  process.exitCode = 1;
}
const unsuccessful =
  records.length === 0 ||
  records.some(
    (record) =>
      record.status === "CHANGES REQUIRED" ||
      record.status === "BLOCKED" ||
      record.status === "UNTESTED" ||
      record.checks.some((check) => check.pass === null),
  );
if (unsuccessful) process.exitCode = 1;
