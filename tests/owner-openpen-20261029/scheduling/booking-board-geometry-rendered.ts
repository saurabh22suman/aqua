#!/usr/bin/env tsx
/**
 * Owner OpenPen — booking board and schedule toolbar geometry check.
 *
 * The 29/30 October 2026 review captured two adjacent-control-group
 * defects and one stretched-surface defect:
 *
 *   • the Day board's range tabs touched the shared navigation row
 *     (0px between the tab list and Previous/Today/Next);
 *   • the Schedule's location filter row touched the same navigation
 *     row (0px between the filter's Apply row and Previous/Today/Next);
 *   • an empty Day board stretched to the height of the selected-slot
 *     column, leaving a 472px empty tail under the board instead of
 *     its own 20px padding.
 *
 * This probe is the DURABLE regression for all three: it measures the
 * rendered geometry — never a class string — of the real surfaces, for
 * BOTH owner themes, at the three owner widths (390, 1024, 1280), in
 * ALL THREE booking scopes (Day, Week, Agenda).
 *
 * It reads no database of its own: sign in with the preview's owner
 * account, read the surfaces, write the evidence.
 *
 * Run only through .opencode/scripts/owner_preview.py (bounded lease):
 *
 *   python3 .opencode/scripts/lane_job.py exec python3 \
 *     .opencode/scripts/owner_preview.py --port <port> --out <out> \
 *     --production -- pnpm exec tsx \
 *     tests/owner-openpen-20261029/scheduling/booking-board-geometry-rendered.ts
 *
 * Exit code 0 means every measured case passed.
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = process.env.AQUA_E2E_BASE_URL ?? "http://127.0.0.1:3273";
const OUT = process.env.AQUA_E2E_OUT ?? ".playwright-mcp/booking-board-geometry";
const PHONE = process.env.AQUA_E2E_PHONE ?? "+919000000001";
const PIN = process.env.AQUA_E2E_PIN ?? "123456";

/**
 * The smallest gap the two control groups may have. DESIGN.md §Spacing
 * allows multiples of 4px; the shared 4px scale step below that is
 * 12px, so 12px is the floor the composition must clear.
 */
const MIN_GROUP_GAP = 12;
/**
 * The board may carry no more empty space below its content than its
 * own bottom padding (plus a sub-pixel slack for the fractional
 * device pixel ratio).
 */
const BOARD_TAIL_SLACK = 2;

const THEMES = ["mint", "lavender"] as const;
const VIEWPORTS = [
  { name: "phone-390x844", width: 390, height: 844 },
  { name: "tablet-1024x768", width: 1024, height: 768 },
  { name: "desktop-1280x900", width: 1280, height: 900 },
];
const SCOPES = ["Day", "Week", "Agenda"] as const;

type Geometry = {
  groupGap: number | null;
  boardTail: number | null;
  boardPaddingBottom: number | null;
  boardHeight: number | null;
  overflow: number;
  /** False when the surface has no location filter to measure. */
  filterPresent: boolean;
};

type Case = {
  surface: "bookings" | "schedule";
  theme: string;
  viewport: string;
  scope: string;
  /** The preset the page actually rendered, read from the document. */
  appliedTheme: string | null;
  geometry: Geometry;
  failures: string[];
};

mkdirSync(OUT, { recursive: true });

async function signIn(context: BrowserContext) {
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}/login`, {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });
    await page.waitForLoadState("networkidle").catch(() => {});
    const submit = page.locator("form button[type=submit]");
    let enabled = false;
    for (let attempt = 0; attempt < 8 && !enabled; attempt += 1) {
      await page.fill("#login-phone", PHONE);
      await page.fill("#login-pin", PIN);
      await page.locator("#login-pin").blur();
      enabled = await page.evaluate(() => {
        const button = document.querySelector(
          'form button[type="submit"]',
        ) as HTMLButtonElement | null;
        return Boolean(button && !button.disabled);
      });
      if (!enabled) await page.waitForTimeout(750);
    }
    if (!enabled) throw new Error("sign-in never became enabled");
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/login"), {
        timeout: 45_000,
      }),
      submit.click(),
    ]);
  } finally {
    await page.close();
  }
}

/**
 * The rendered geometry of the booking board: the vertical gap between
 * the Calendar range tab list and the shared navigation row, and the
 * empty space below the board's last child.
 */
async function measureBoard(page: Page): Promise<Geometry> {
  return await page.evaluate(() => {
    const overflow =
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth;
    const board = document.querySelector('[data-testid="booking-board"]');
    const tabs = board?.querySelector(
      '[role="tablist"][aria-label="Calendar range"]',
    );
    const previous = board?.querySelector('[data-testid="calendar-previous"]');
    if (!board || !tabs || !previous) {
      return {
        groupGap: null,
        boardTail: null,
        boardPaddingBottom: null,
        boardHeight: null,
        overflow,
        filterPresent: false,
      };
    }
    const boardRect = board.getBoundingClientRect();
    const last = board.lastElementChild?.getBoundingClientRect() ?? null;
    return {
      groupGap:
        previous.getBoundingClientRect().top -
        tabs.getBoundingClientRect().bottom,
      boardTail: last ? boardRect.bottom - last.bottom : null,
      boardPaddingBottom:
        Number.parseFloat(getComputedStyle(board).paddingBottom) || 0,
      boardHeight: boardRect.height,
      overflow,
      filterPresent: true,
    };
  });
}

/**
 * The rendered geometry of the Schedule: the vertical gap between the
 * tenant's location filter row and the shared navigation row.
 *
 * The location filter only renders for a tenant with more than one
 * location. A single-location tenant records `filterPresent: false`
 * and is not a pass or a failure — the adjacency cannot exist there.
 */
async function measureSchedule(page: Page): Promise<Geometry> {
  return await page.evaluate(() => {
    const overflow =
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth;
    const previous = document.querySelector('[data-testid="calendar-previous"]');
    const filter = document
      .querySelector('select[name="location"]')
      ?.closest("form");
    if (!previous || !filter) {
      return {
        groupGap: null,
        boardTail: null,
        boardPaddingBottom: null,
        boardHeight: null,
        overflow,
        filterPresent: Boolean(filter),
      };
    }
    return {
      groupGap:
        previous.getBoundingClientRect().top -
        filter.getBoundingClientRect().bottom,
      boardTail: null,
      boardPaddingBottom: null,
      boardHeight: null,
      overflow,
      filterPresent: true,
    };
  });
}

async function main(): Promise<number> {
  // Real Chrome, the same browser the owner review captures use.
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const cases: Case[] = [];
  try {
    for (const theme of THEMES) {
      for (const viewport of VIEWPORTS) {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          locale: "en-IN",
          timezoneId: "Asia/Kolkata",
          reducedMotion: "reduce",
        });
        await signIn(context);
        // The preset is written AFTER the sign-in: the login route
        // clears the device's theme and facility cookies on success
        // (shared-device privacy), so a cookie written before it is
        // gone by the time the owner page loads — every "theme" really
        // measured Mint.
        await context.addCookies([
          { name: "aqua_theme", value: theme, url: BASE_URL },
        ]);
        const page = await context.newPage();

        // ── The booking desk: Day, Week and Agenda. ──────────────────
        await page.goto(`${BASE_URL}/owner/bookings`, {
          waitUntil: "networkidle",
          timeout: 120_000,
        });
        await page
          .locator('[data-testid="booking-board"]')
          .waitFor({ state: "visible", timeout: 60_000 });

        // The preset the document really carries. A capture labelled
        // with a theme the page did not render is a failed case, never
        // a pass.
        const bookingTheme = await page.evaluate(() =>
          document.documentElement.getAttribute("data-theme"),
        );
        const bookingThemeFailure =
          bookingTheme === theme
            ? []
            : [
                `the page renders the "${bookingTheme ?? "no"}" preset, not the requested "${theme}"`,
              ];

        for (const scope of SCOPES) {
          await page
            .getByRole("tablist", { name: "Calendar range", exact: true })
            .getByRole("tab", { name: scope, exact: true })
            .click();
          await page.waitForTimeout(400);
          const geometry = await measureBoard(page);
          const failures: string[] = [...bookingThemeFailure];
          if (geometry.groupGap === null) {
            failures.push(
              "the board has no Calendar range tabs or Previous control",
            );
          } else if (geometry.groupGap < MIN_GROUP_GAP) {
            failures.push(
              `the range tabs and the navigation row are ${geometry.groupGap.toFixed(2)}px apart; at least ${MIN_GROUP_GAP}px is required`,
            );
          }
          if (viewport.width >= 1024) {
            if (geometry.boardTail === null) {
              failures.push("the board has no content to measure");
            } else if (
              geometry.boardTail >
              (geometry.boardPaddingBottom ?? 0) + BOARD_TAIL_SLACK
            ) {
              failures.push(
                `the board carries ${geometry.boardTail.toFixed(2)}px below its content; its own bottom padding is ${geometry.boardPaddingBottom}px`,
              );
            }
          }
          if (geometry.overflow > 1) {
            failures.push(
              `the page overflows horizontally by ${geometry.overflow}px`,
            );
          }
          cases.push({
            surface: "bookings",
            theme,
            viewport: viewport.name,
            scope,
            appliedTheme: bookingTheme,
            geometry,
            failures,
          });
          await page.screenshot({
            path: join(OUT, `${theme}-${viewport.width}-${scope}.png`),
            fullPage: false,
          });
        }

        // ── The schedule: the location filter against the same row. ──
        await page.goto(`${BASE_URL}/owner/schedule`, {
          waitUntil: "networkidle",
          timeout: 120_000,
        });
        await page
          .locator('[data-testid="calendar-previous"]')
          .waitFor({ state: "visible", timeout: 60_000 });
        const schedule = await measureSchedule(page);
        const scheduleTheme = await page.evaluate(() =>
          document.documentElement.getAttribute("data-theme"),
        );
        const scheduleThemeFailure =
          scheduleTheme === theme
            ? []
            : [
                `the page renders the "${scheduleTheme ?? "no"}" preset, not the requested "${theme}"`,
              ];
        const scheduleFailures: string[] = [...scheduleThemeFailure];
        if (schedule.filterPresent) {
          if (schedule.groupGap === null) {
            scheduleFailures.push(
              "the schedule has a location filter but no navigation row to measure",
            );
          } else if (schedule.groupGap < MIN_GROUP_GAP) {
            scheduleFailures.push(
              `the location filter and the navigation row are ${schedule.groupGap.toFixed(2)}px apart; at least ${MIN_GROUP_GAP}px is required`,
            );
          }
        }
        if (schedule.overflow > 1) {
          scheduleFailures.push(
            `the page overflows horizontally by ${schedule.overflow}px`,
          );
        }
        cases.push({
          surface: "schedule",
          theme,
          viewport: viewport.name,
          scope: "default",
          appliedTheme: scheduleTheme,
          geometry: schedule,
          failures: scheduleFailures,
        });
        await page.screenshot({
          path: join(OUT, `${theme}-${viewport.width}-schedule.png`),
          fullPage: false,
        });

        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  const failures = cases.filter((item) => item.failures.length > 0);
  writeFileSync(
    join(OUT, "booking-board-geometry.json"),
    `${JSON.stringify(
      { at: new Date().toISOString(), cases, failures: failures.length },
      null,
      2,
    )}\n`,
  );
  for (const item of failures) {
    console.log(
      `CHANGES REQUIRED ${item.surface}/${item.theme}/${item.viewport}/${item.scope}: ${item.failures.join("; ")}`,
    );
  }
  console.log(
    `booking board + schedule geometry: ${cases.length - failures.length}/${cases.length} cases passed`,
  );
  return failures.length > 0 ? 1 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(
      `BOOKING BOARD GEOMETRY STOP: ${String(error).slice(0, 800)}`,
    );
    process.exitCode = 1;
  });
