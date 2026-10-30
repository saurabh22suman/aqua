#!/usr/bin/env node
/**
 * Staging release readiness — MULTI-EDITOR form invariants, in real Chrome.
 *
 * Two source-confirmed risks, both of the same shape: ONE editor mounted
 * TWICE (or two editors of the same kind on one page), and each mounted copy
 * owning its own ids or its own state.
 *
 *   1. components/settings/business-hours-editor.tsx derives its TimeField ids
 *      from the WEEKDAY alone (`hours-${day}-open`). Two locations open on the
 *      same page therefore emit the SAME ids, and a native `<label for>` names
 *      the FIRST element carrying that id — so the second editor's labels and
 *      its help reference point at the FIRST editor's controls.
 *   2. components/programs-batches-board.tsx mounts the desktop table copy AND
 *      the phone list copy of BatchEditForm, and each copy keeps its own
 *      `useState(initial)`. The parent already holds `editBatchForm`, but the
 *      copies do not read it, so a draft typed into the visible copy is not in
 *      the other copy: a viewport change shows the other copy's values.
 *
 * The driver PROVES both in a browser, at both approved widths, in both
 * approved themes, and it never saves anything.
 *
 * Run it through the bounded preview (root owns the shared queue):
 *
 *   python3 .opencode/scripts/lane_job.py exec \
 *     python3 .opencode/scripts/owner_preview.py --port 3275 --production \
 *       --timeout 900 --out .playwright-mcp/multi-editor-forms -- \
 *     env AQUA_E2E_OUT=.playwright-mcp/multi-editor-forms \
 *     node --experimental-strip-types \
 *     tests/staging-release-20261030/multi-editor-forms-chrome.ts
 *
 * `node --experimental-strip-types`, NEVER tsx: tsx/esbuild keepNames
 * injects `__name` into every function it compiles, and Playwright serialises
 * the functions passed to locator.evaluate() into the page — the page then
 * throws "ReferenceError: __name is not defined". The in-page audits below ARE
 * the evidence, so they have to actually run.
 *
 * Rules this driver obeys:
 *   - the INSTALLED Chrome channel (channel: "chrome"), one isolated browser
 *     context per theme/width, en-IN / Asia/Kolkata;
 *   - a synthetic sign-in (+919000000001 / 123456) BEFORE any theme is applied
 *     — the theme is a cookie the server reads when it renders;
 *   - NO Save, payment, send, credential, delete or approve action is ever
 *     clicked. The drafts below are local component state only;
 *   - NO data injection, NO network mocking, NO CSS patching, NO forced
 *     clicks and NO dispatchEvent: every assertion reads what the page
 *     rendered, and every interaction is a real click or real typing;
 *   - a missing control is a FAILURE, never a skip: a required case that
 *     cannot find its control records the failure and exits non-zero;
 *   - hidden duplicate DOM copies are never acted on and never read as the
 *     visible truth — every control is scoped to the copy the owner can see.
 *
 * Exit code 0 means every invariant held.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  chromium,
  type BrowserContext,
  type Locator,
  type Page,
} from "playwright";

const BASE_URL = process.env.AQUA_E2E_BASE_URL ?? "";
const OUT = resolve(
  process.env.AQUA_E2E_OUT ?? ".playwright-mcp/multi-editor-forms",
);
const SHOTS = resolve(OUT, "screenshots");
const PHONE = process.env.AQUA_E2E_PHONE ?? "+919000000001";
const PIN = process.env.AQUA_E2E_PIN ?? "123456";
const THEMES = (process.env.AQUA_E2E_THEMES ?? "mint,lavender")
  .split(",")
  .map((theme) => theme.trim())
  .filter(Boolean);

const PHONE_VIEWPORT = { name: "phone-390x844", width: 390, height: 844 };
const DESKTOP_VIEWPORT = { name: "desktop-1280x900", width: 1280, height: 900 };

type Viewport = { name: string; width: number; height: number };
type Check = { name: string; pass: boolean; detail: string };
type Observation = { label: string; value: unknown };
type RunRecord = {
  theme: string;
  viewport: string;
  status: string;
  checks: Check[];
  observations: Observation[];
};

function record(
  checks: Check[],
  name: string,
  pass: boolean,
  detail: string,
): void {
  checks.push({ name, pass, detail });
}

/**
 * A required control must be present AND unambiguous.
 *
 * A missing control is recorded as a FAILED check and the caller stops that
 * case: a required case never passes because its control could not be found.
 */
async function requireVisible(
  locator: Locator,
  label: string,
  checks: Check[],
  timeout = 30_000,
): Promise<boolean> {
  try {
    await locator.first().waitFor({ state: "visible", timeout });
  } catch {
    const inDocument = await locator.count();
    record(
      checks,
      `${label}.present`,
      false,
      `no visible ${label} within ${timeout}ms (matches in the document: ${inDocument})`,
    );
    return false;
  }
  const count = await locator.count();
  if (count !== 1) {
    record(
      checks,
      `${label}.single`,
      false,
      `expected exactly one visible ${label}; found ${count}`,
    );
    return false;
  }
  return true;
}

async function open(page: Page, path: string): Promise<void> {
  await page.goto(`${BASE_URL}${path}`, {
    waitUntil: "domcontentloaded",
    timeout: 90_000,
  });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.locator("main").waitFor({ state: "visible", timeout: 60_000 });
}

/** The synthetic owner's sign-in, on its own page, then the page is closed. */
async function signIn(context: BrowserContext): Promise<void> {
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}/login`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    await page.waitForLoadState("networkidle").catch(() => {});
    const submit = page.locator("form button[type=submit]");
    let ready = false;
    for (let attempt = 0; attempt < 8 && !ready; attempt++) {
      await page.fill("#login-phone", PHONE);
      await page.fill("#login-pin", PIN);
      await page.locator("#login-pin").blur();
      ready = await page.evaluate(() => {
        const button = document.querySelector(
          'form button[type="submit"]',
        ) as HTMLButtonElement | null;
        return Boolean(button && !button.disabled);
      });
      if (!ready) await page.waitForTimeout(750);
    }
    if (!ready) throw new Error("synthetic sign-in did not become ready");
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/login"), {
        timeout: 45_000,
      }),
      submit.click(),
    ]);
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * RISK 1 — the business-hours editor on /owner/settings/locations.
 *
 * Both locations' Monday switches are turned ON as UNSAVED drafts so that
 * every location renders its own Monday time controls, and the page is then
 * audited for id ownership and for label/help references that leave the
 * editor they belong to. Nothing is ever saved.
 */
async function businessHoursScenario(
  page: Page,
  checks: Check[],
  observations: Observation[],
  theme: string,
  viewport: Viewport,
): Promise<void> {
  await open(page, "/owner/settings/locations");

  // The theme cookie is read by the server when it renders, so the rendered
  // preset is only meaningful on a page loaded AFTER the cookie was set.
  const renderedTheme = await page.evaluate(
    () => document.documentElement.dataset.theme ?? "",
  );
  record(
    checks,
    "theme.applied",
    renderedTheme === theme,
    `requested=${theme}; rendered=${renderedTheme || "none"}`,
  );

  const cards = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Weekly hours", exact: true }),
    });
  await cards.first().waitFor({ state: "visible", timeout: 30_000 });
  const cardCount = await cards.count();
  record(
    checks,
    "hours.two-editors-present",
    cardCount >= 2,
    `${cardCount} location editor(s) rendered on /owner/settings/locations`,
  );
  if (cardCount < 2) return;

  const persisted: { name: string; mondayOpen: boolean }[] = [];

  for (let index = 0; index < cardCount; index++) {
    const card = cards.nth(index);
    const name = ((await card.locator("h2").first().textContent()) ?? "").trim();
    const key = `hours.${name || `editor-${index + 1}`}`;

    const monday = card.locator('input[aria-label="monday open"]');
    if (!(await requireVisible(monday, `${key}.monday-switch`, checks))) {
      continue;
    }
    const mondayOpen = await monday.isChecked();
    persisted.push({ name, mondayOpen });
    if (!mondayOpen) {
      // An UNSAVED draft: the editor's own state, never persisted.
      await monday.click();
    }

    const opening = card.locator('fieldset[id^="hours-monday-open"]');
    const closing = card.locator('fieldset[id^="hours-monday-close"]');
    if (
      !(await requireVisible(opening, `${key}.monday-opening-fieldset`, checks))
    ) {
      continue;
    }
    if (
      !(await requireVisible(closing, `${key}.monday-closing-fieldset`, checks))
    ) {
      continue;
    }

    const audit = await card.evaluate((root) => {
      const doc = document;
      const counts = new Map<string, number>();
      for (const element of Array.from(doc.querySelectorAll("[id]"))) {
        counts.set(element.id, (counts.get(element.id) ?? 0) + 1);
      }
      const controls = Array.from(root.querySelectorAll<HTMLElement>("[id]"));
      const duplicated = Array.from(
        new Set(
          controls
            .map((element) => element.id)
            .filter((id) => (counts.get(id) ?? 0) > 1),
        ),
      );
      const labels = Array.from(
        root.querySelectorAll<HTMLLabelElement>("label[for]"),
      ).map((label) => {
        const forId = label.getAttribute("for") ?? "";
        const target = doc.getElementById(forId);
        return {
          for: forId,
          inside: Boolean(target && root.contains(target)),
          resolvedId: target?.id ?? null,
        };
      });
      const described: { owner: string; token: string; inside: boolean }[] = [];
      for (const element of Array.from(
        root.querySelectorAll<HTMLElement>("[aria-describedby]"),
      )) {
        const tokens = (element.getAttribute("aria-describedby") ?? "")
          .split(/\s+/)
          .filter(Boolean);
        for (const token of tokens) {
          const target = doc.getElementById(token);
          described.push({
            owner: element.id || element.tagName,
            token,
            inside: Boolean(target && root.contains(target)),
          });
        }
      }
      const monday = Array.from(
        root.querySelectorAll<HTMLFieldSetElement>(
          'fieldset[id^="hours-monday-"]',
        ),
      ).map((fieldset) => ({
        id: fieldset.id,
        selects: fieldset.querySelectorAll("select").length,
      }));
      return {
        duplicated,
        labels,
        described,
        monday,
        controlCount: controls.length,
      };
    });

    observations.push({
      label: `${key}.audit`,
      value: {
        controlCount: audit.controlCount,
        duplicatedIds: audit.duplicated,
        foreignLabels: audit.labels.filter((entry) => !entry.inside),
        foreignHelp: audit.described.filter((entry) => !entry.inside),
        mondayFieldsets: audit.monday,
      },
    });

    record(
      checks,
      `${key}.unique-control-ids`,
      audit.duplicated.length === 0,
      audit.duplicated.length === 0
        ? `${audit.controlCount} ids in this editor, each with exactly one owner in the document`
        : `these ids are also carried by another editor on the page: ${audit.duplicated.join(", ")}`,
    );

    const foreignLabels = audit.labels.filter((entry) => !entry.inside);
    record(
      checks,
      `${key}.labels-point-inside`,
      foreignLabels.length === 0,
      foreignLabels.length === 0
        ? `${audit.labels.length} native labels resolve inside this editor`
        : `${foreignLabels.length} native label(s) point at another editor's control: ${foreignLabels
            .map((entry) => entry.for)
            .join(", ")}`,
    );

    const foreignHelp = audit.described.filter((entry) => !entry.inside);
    record(
      checks,
      `${key}.help-points-inside`,
      foreignHelp.length === 0,
      foreignHelp.length === 0
        ? `${audit.described.length} help references resolve inside this editor`
        : `${foreignHelp.length} help reference(s) point at another editor's text: ${foreignHelp
            .map((entry) => entry.token)
            .join(", ")}`,
    );

    record(
      checks,
      `${key}.monday-controls-rendered`,
      audit.monday.length === 2 && audit.monday.every((f) => f.selects === 3),
      `monday field groups: ${audit.monday
        .map((f) => `${f.id}(${f.selects} selects)`)
        .join(", ")}`,
    );
  }

  await page.screenshot({
    path: `${SHOTS}/${theme}-${viewport.width}-business-hours.png`,
    fullPage: true,
  });

  // The reload proves the Monday drafts were NOT saved: the persisted state
  // of every location's Monday switch must be exactly what it was before.
  await page.reload({ waitUntil: "networkidle" });
  const cardsAfter = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Weekly hours", exact: true }),
    });
  await cardsAfter.first().waitFor({ state: "visible", timeout: 30_000 });
  for (let index = 0; index < persisted.length; index++) {
    const entry = persisted[index];
    const monday = cardsAfter
      .nth(index)
      .locator('input[aria-label="monday open"]');
    if (!(await requireVisible(monday, `hours.${entry.name}.reload-switch`, checks))) {
      continue;
    }
    const nowOpen = await monday.isChecked();
    record(
      checks,
      `hours.${entry.name}.draft-not-saved`,
      nowOpen === entry.mondayOpen,
      `after the reload the Monday switch is ${nowOpen ? "on" : "off"}; the persisted state was ${entry.mondayOpen ? "on" : "off"}`,
    );
  }
}

/**
 * RISK 2 — the batch edit draft on /owner/programs.
 *
 * The desktop table copy and the phone list copy of BatchEditForm are both
 * mounted. A name and a capacity are typed into the copy the owner can see,
 * the viewport is changed to the other approved width and back, and the draft
 * must survive both directions. Nothing is ever saved. The earlier useId fix
 * (unique ids per mounted copy) is audited as well, so the fix for this risk
 * cannot quietly undo it.
 */
async function batchDraftScenario(
  page: Page,
  checks: Check[],
  observations: Observation[],
  theme: string,
  viewport: Viewport,
): Promise<void> {
  await open(page, "/owner/programs");

  const board = page.locator("section").filter({
    has: page.locator(
      '[data-testid="batches-list"], [data-testid="batches-list-mobile"]',
    ),
  });
  if (!(await requireVisible(board, "batches.board", checks))) return;

  const visibleList = page
    .locator('[data-testid="batches-list-mobile"], [data-testid="batches-list"]')
    .filter({ visible: true });
  if (!(await requireVisible(visibleList, "batches.visible-list", checks))) {
    return;
  }

  const openLinks = visibleList
    .locator('a[href^="/owner/batches/"]')
    .filter({ visible: true });
  const linkCount = await openLinks.count();
  if (linkCount === 0) {
    record(
      checks,
      "batches.batch-available",
      false,
      "no batch row with an Open link is rendered on /owner/programs",
    );
    return;
  }
  const href = (await openLinks.first().getAttribute("href")) ?? "";
  const batchId = href.split("/").filter(Boolean).pop() ?? "";
  record(
    checks,
    "batches.batch-available",
    batchId.length > 0,
    `editing the first visible batch row (${batchId})`,
  );
  if (!batchId) return;

  const desktopRow = page.locator(`[data-testid="batch-row-${batchId}"]`);
  const phoneRow = page
    .locator('[data-testid="batches-list-mobile"] li')
    .filter({ has: page.locator(`a[href="/owner/batches/${batchId}"]`) });
  const row = desktopRow.or(phoneRow).filter({ visible: true });
  if (!(await requireVisible(row, "batches.row", checks))) return;

  const editButton = row
    .locator('button[aria-label^="Edit "]')
    .filter({ visible: true });
  if (!(await requireVisible(editButton, "batches.edit-control", checks))) return;
  await editButton.click();

  // The name and capacity controls, scoped to the copy that is on screen.
  const nameInput = page
    .locator(`[data-testid="edit-batch-name-${batchId}"]`)
    .filter({ visible: true });
  const capacityInput = page
    .locator('input[aria-label="Capacity"]')
    .filter({ visible: true });
  if (!(await requireVisible(nameInput, "batches.name-input", checks))) return;
  if (
    !(await requireVisible(capacityInput, "batches.capacity-input", checks))
  ) {
    return;
  }

  const originalName = await nameInput.inputValue();
  const originalCapacity = await capacityInput.inputValue();
  const draftName = `QA draft multi-editor ${theme}-${viewport.width}-${Date.now().toString(36)}`;
  const draftCapacity = "37";
  await nameInput.fill(draftName);
  await capacityInput.fill(draftCapacity);
  const typedName = await nameInput.inputValue();
  const typedCapacity = await capacityInput.inputValue();
  record(
    checks,
    "batches.draft-entered",
    typedName === draftName && typedCapacity === draftCapacity,
    `the visible editor holds name="${typedName}" capacity="${typedCapacity}"`,
  );

  // The earlier useId fix — both copies keep unique ids and their own labels.
  const copyAudit = await board.evaluate((root) => {
    const doc = document;
    const counts = new Map<string, number>();
    for (const element of Array.from(doc.querySelectorAll("[id]"))) {
      counts.set(element.id, (counts.get(element.id) ?? 0) + 1);
    }
    const controls = Array.from(root.querySelectorAll<HTMLElement>("[id]"));
    const duplicated = Array.from(
      new Set(
        controls
          .map((element) => element.id)
          .filter((id) => (counts.get(id) ?? 0) > 1),
      ),
    );
    const selects = Array.from(
      root.querySelectorAll<HTMLSelectElement>(
        'select[aria-label="Hour"], select[aria-label="Minutes"], select[aria-label="AM/PM"]',
      ),
    );
    const labels = selects.map((select) => {
      const owner = select.closest(
        '[data-testid="batches-list"], [data-testid="batches-list-mobile"]',
      );
      const own = select.labels ? Array.from(select.labels) : [];
      return {
        id: select.id,
        labelCount: own.length,
        labelsInside: owner ? own.every((label) => owner.contains(label)) : false,
        resolvesToSelf: doc.getElementById(select.id) === select,
      };
    });
    const testIds = ["edit-batch-name", "edit-batch-start", "edit-batch-end"].map(
      (prefix) => ({
        prefix,
        count: root.querySelectorAll(`[data-testid^="${prefix}-"]`).length,
      }),
    );
    return { duplicated, labels, testIds };
  });

  observations.push({
    label: "batches.copy-audit",
    value: {
      duplicatedIds: copyAudit.duplicated,
      timeSelects: copyAudit.labels,
      testIds: copyAudit.testIds,
    },
  });

  record(
    checks,
    "batches.copy-ids-unique",
    copyAudit.duplicated.length === 0,
    copyAudit.duplicated.length === 0
      ? `every id in the board has exactly one owner in the document`
      : `these ids are carried by both mounted copies: ${copyAudit.duplicated.join(", ")}`,
  );
  const badLabels = copyAudit.labels.filter(
    (entry) =>
      entry.labelCount < 1 || !entry.labelsInside || !entry.resolvesToSelf,
  );
  record(
    checks,
    "batches.copy-labels-inside",
    badLabels.length === 0,
    badLabels.length === 0
      ? `${copyAudit.labels.length} time selects are labelled by their own copy`
      : `${badLabels.length} time select(s) are not labelled by their own copy: ${badLabels
          .map((entry) => entry.id)
          .join(", ")}`,
  );
  const badTestIds = copyAudit.testIds.filter(
    (entry) => entry.count !== 2,
  );
  record(
    checks,
    "batches.test-ids-stable",
    badTestIds.length === 0,
    badTestIds.length === 0
      ? `each batch test id is present once per mounted copy (2 copies)`
      : `unexpected test id counts: ${badTestIds
          .map((entry) => `${entry.prefix}=${entry.count}`)
          .join(", ")}`,
  );

  await page.screenshot({
    path: `${SHOTS}/${theme}-${viewport.width}-batch-edit.png`,
  });

  // The viewport journey: the visible copy changes, the draft must not.
  const startIsPhone = viewport.width < 768;
  const other = startIsPhone ? DESKTOP_VIEWPORT : PHONE_VIEWPORT;
  const desktopName = page.locator(
    `[data-testid="batch-row-${batchId}"] [data-testid="edit-batch-name-${batchId}"]`,
  );
  const phoneName = page.locator(
    `[data-testid="batches-list-mobile"] [data-testid="edit-batch-name-${batchId}"]`,
  );
  const desktopCapacity = page.locator(
    `[data-testid="batch-row-${batchId}"] input[aria-label="Capacity"]`,
  );
  const phoneCapacity = page.locator(
    `[data-testid="batches-list-mobile"] input[aria-label="Capacity"]`,
  );
  const startName = startIsPhone ? phoneName : desktopName;
  const startCapacity = startIsPhone ? phoneCapacity : desktopCapacity;
  const otherName = startIsPhone ? desktopName : phoneName;
  const otherCapacity = startIsPhone ? desktopCapacity : phoneCapacity;

  await page.setViewportSize({ width: other.width, height: other.height });
  if (!(await requireVisible(otherName, `batches.other-copy-name`, checks))) {
    return;
  }
  const otherNameValue = await otherName.inputValue();
  const otherCapacityValue = await otherCapacity.inputValue();
  record(
    checks,
    `batches.draft-survives-resize-to-${other.width}`,
    otherNameValue === draftName && otherCapacityValue === draftCapacity,
    `the visible ${other.name} copy shows name="${otherNameValue}" capacity="${otherCapacityValue}"; the draft was name="${draftName}" capacity="${draftCapacity}"`,
  );
  await page.screenshot({
    path: `${SHOTS}/${theme}-${viewport.width}-batch-edit-resized.png`,
  });

  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  if (!(await requireVisible(startName, `batches.start-copy-name`, checks))) {
    return;
  }
  const backNameValue = await startName.inputValue();
  const backCapacityValue = await startCapacity.inputValue();
  record(
    checks,
    `batches.draft-survives-resize-back-to-${viewport.width}`,
    backNameValue === draftName && backCapacityValue === draftCapacity,
    `the visible ${viewport.name} copy shows name="${backNameValue}" capacity="${backCapacityValue}"; the draft was name="${draftName}" capacity="${draftCapacity}"`,
  );

  observations.push({
    label: "batches.draft",
    value: {
      batchId,
      originalName,
      originalCapacity,
      draftName,
      draftCapacity,
      otherNameValue,
      otherCapacityValue,
      backNameValue,
      backCapacityValue,
    },
  });

  // The reload proves nothing was saved: the draft must be gone from the
  // rendered page and the persisted batch must still carry its own values.
  await page.reload({ waitUntil: "networkidle" });
  const draftVisible = await page
    .locator("main")
    .getByText(draftName, { exact: false })
    .filter({ visible: true })
    .count();
  record(
    checks,
    "batches.draft-not-saved",
    draftVisible === 0,
    `after the reload the draft name appears ${draftVisible} time(s) on the page`,
  );
  const originalVisible = await page
    .locator("main")
    .getByText(originalName, { exact: true })
    .filter({ visible: true })
    .count();
  record(
    checks,
    "batches.persisted-row-unchanged",
    originalVisible > 0,
    `the persisted batch name "${originalName}" is still rendered (${originalVisible} match(es))`,
  );
}

async function runScenario(
  page: Page,
  checks: Check[],
  observations: Observation[],
  theme: string,
  viewport: Viewport,
): Promise<void> {
  await businessHoursScenario(page, checks, observations, theme, viewport);
  await batchDraftScenario(page, checks, observations, theme, viewport);
}

async function main(): Promise<number> {
  if (!BASE_URL) {
    throw new Error("AQUA_E2E_BASE_URL must name the bounded preview.");
  }
  mkdirSync(SHOTS, { recursive: true });

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const records: RunRecord[] = [];
  try {
    for (const theme of THEMES) {
      for (const viewport of [PHONE_VIEWPORT, DESKTOP_VIEWPORT]) {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          locale: "en-IN",
          timezoneId: "Asia/Kolkata",
          reducedMotion: "reduce",
        });
        const page = await context.newPage();
        page.setDefaultTimeout(20_000);
        const checks: Check[] = [];
        const observations: Observation[] = [];
        try {
          await signIn(context);
          // The theme is applied AFTER the synthetic sign-in: the cookie is
          // what the server reads when it renders the page.
          await context.addCookies([
            { name: "aqua_theme", value: theme, url: BASE_URL },
          ]);
          await runScenario(page, checks, observations, theme, viewport);
        } catch (error) {
          record(
            checks,
            "scenario-completed",
            false,
            String(error).slice(0, 800),
          );
          await page
            .screenshot({
              path: `${SHOTS}/${theme}-${viewport.width}-failure.png`,
            })
            .catch(() => {});
        }
        records.push({
          theme,
          viewport: viewport.name,
          status: checks.every((check) => check.pass)
            ? "PASS"
            : "CHANGES REQUIRED",
          checks,
          observations,
        });
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  const failures = records.flatMap((run) =>
    run.checks
      .filter((check) => !check.pass)
      .map((check) => ({
        theme: run.theme,
        viewport: run.viewport,
        name: check.name,
        detail: check.detail,
      })),
  );

  writeFileSync(
    `${OUT}/multi-editor-forms.json`,
    `${JSON.stringify(
      {
        at: new Date().toISOString(),
        baseUrl: BASE_URL,
        mode:
          "real Chrome; synthetic sign-in; unsaved local drafts only; no save, payment, send or credential action",
        invariants: [
          "every location's business-hours control id has one owner in the document",
          "every location's native labels and help references point inside that editor",
          "a batch edit draft survives a viewport change in both directions",
          "the earlier useId fix (unique ids and own labels per mounted copy) still holds",
          "no draft is persisted",
        ],
        records,
        failures,
      },
      null,
      2,
    )}\n`,
  );

  console.log(
    JSON.stringify({
      runs: records.length,
      checks: records.reduce((total, run) => total + run.checks.length, 0),
      failures,
    }),
  );
  return failures.length ? 1 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`MULTI-EDITOR REVIEWER STOP: ${String(error).slice(0, 800)}`);
    process.exitCode = 1;
  });
