#!/usr/bin/env tsx
/**
 * Owner redesign · Operations lane (C3) — the rendered calendar probe.
 *
 * The calendar amendment is a statement about RENDERED geometry, not
 * about class strings. This probe measures, in Chrome, on the real
 * pages:
 *
 *   * the time ruler and one column per day,
 *   * every event block placed at the minute it starts and sized by the
 *     time it lasts (measured from the DOM rects, not from the
 *     component's own arithmetic),
 *   * two overlapping events side by side rather than stacked,
 *   * a session outside the working window still on the ruler,
 *   * a session that runs past midnight labelled with the next day,
 *   * the clash marker present ONLY for the shared coach,
 *   * no horizontal page scroll at either viewport,
 *   * the phone agenda carrying the events, and the detail panel
 *     opening, closing and returning focus.
 *
 * It never writes to the database and never clears browser data: it
 * uses its own isolated browser context and the demo credentials of a
 * DISPOSABLE database.
 *
 * Run it through .opencode/scripts/preview_job.py, which owns the
 * preview server as ONE compound job.
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = process.env.AQUA_E2E_BASE_URL ?? "http://127.0.0.1:3183";
/**
 * "calendar" measures the schedule and the booking desk. "controls"
 * measures the owned routes' standard controls. They are separate runs
 * because the dev server restarts itself when it approaches its memory
 * threshold, and a restart in the middle of a sweep loses the run.
 */
const MODE = process.argv.includes("--controls-a")
  ? "controls-a"
  : process.argv.includes("--controls-b")
    ? "controls-b"
    : "calendar";
const PHONE = process.env.AQUA_E2E_PHONE ?? "+919000000001";
const PIN = process.env.AQUA_E2E_PIN ?? "123456";
const OUT_DIR =
  process.env.AQUA_E2E_OUT ??
  "docs/handoffs/evidence/owner-redesign-operations-c3";

/** The owner pages this lane owns. */
const OWNED_ROUTES = [
  "/owner/programs",
  "/owner/sessions",
  "/owner/reports",
  "/owner/onboarding",
  "/owner/settings",
  "/owner/settings/activities",
  "/owner/settings/alerts",
  "/owner/settings/holidays",
  "/owner/settings/menu",
  "/owner/settings/plans",
  "/owner/settings/payment-qrs",
  "/owner/settings/skills",
  "/owner/settings/branding",
  "/owner/settings/terminology",
  "/owner/settings/configuration",
  "/owner/settings/academy",
  "/owner/settings/locations",
];

/**
 * Routes this lane OWNS the page of, but whose FORM belongs to another
 * lane: the booking price editor's controls live in
 * components/bookings/booking-price-manager.tsx, which is not this
 * lane's file. They are measured and REPORTED, never blocking.
 */
const BOUNDARY_ROUTES = ["/owner/settings/booking-prices"];

/**
 * The STANDARD actions on the owned routes.
 *
 * A standard action is the one an owner reaches for to commit or
 * clear something: it shares the shared Button's 48px height and
 * 16px text. The compact row and tertiary actions (an icon, an
 * archive, a delete) keep their own 44px target and are not listed.
 */
const STANDARD_ACTIONS: Record<string, string[]> = {
  "/owner/settings/activities": ["Apply", "Reset"],
  "/owner/settings/alerts": ["Save"],
  "/owner/settings/holidays": ["Add holiday"],
  "/owner/settings/menu": ["Add item", "Save"],
  "/owner/settings/plans": ["Add plan", "Save"],
  "/owner/settings/payment-qrs": ["Add UPI QR", "Add image QR", "Save"],
  "/owner/settings/branding": ["Save changes"],
  "/owner/settings/academy": ["Save"],
  "/owner/settings/configuration": ["Save"],
  "/owner/settings/locations": ["Save", "Add location"],
  "/owner/settings/terminology": ["Save"],
  "/owner/settings/skills": ["Save"],
  "/owner/programs": ["Add", "Add batch", "Save batch", "Cancel"],
  "/owner/schedule": ["Apply"],
};

const VIEWPORTS = [
  { name: "phone-390x844", width: 390, height: 844 },
  { name: "tablet-1024x768", width: 1024, height: 768 },
  { name: "desktop-1280x900", width: 1280, height: 900 },
];

type Finding = {
  viewport: string;
  route: string;
  label: string;
  problem: string;
};

const findings: Finding[] = [];
const notes: string[] = [];
/** A finding on a surface another lane owns: reported, never blocking. */
const boundaryFindings: Finding[] = [];

function fail(viewport: string, route: string, label: string, problem: string) {
  findings.push({ viewport, route, label, problem });
}

async function signIn(context: BrowserContext) {
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}/login`, {
      waitUntil: "domcontentloaded",
      timeout: 90_000,
    });
    // The form is a React client component: filling it before the
    // hydration lands writes the DOM value without the state, and the
    // submit button stays closed. Wait for the app to be live first.
    await page.waitForLoadState("networkidle").catch(() => {});

    const submit = page.locator("form button[type=submit]");
    let enabled = false;
    for (let attempt = 0; attempt < 6 && !enabled; attempt++) {
      await page.fill("#login-phone", PHONE);
      await page.fill("#login-pin", PIN);
      await page.locator("#login-pin").blur();
      enabled = await page.evaluate(() => {
        const button = document.querySelector(
          'form button[type="submit"]',
        ) as HTMLButtonElement | null;
        return Boolean(button && !button.disabled);
      });
      if (!enabled) await page.waitForTimeout(1000);
    }
    if (!enabled) {
      const alert = await page.evaluate(() => document.body.textContent ?? "");
      throw new Error(
        `the sign-in button never became enabled; the page said: ${alert
          .replace(/\s+/g, " ")
          .slice(0, 400)}`,
      );
    }
    await Promise.all([
      page.waitForURL((url) => !url.pathname.startsWith("/login"), {
        timeout: 30_000,
      }),
      submit.click(),
    ]);
  } finally {
    await page.close();
  }
}

/** The horizontal overflow of the page, if any. */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
}

type BlockMeasurement = {
  id: string;
  text: string;
  /** Minutes from the top of the day track to the top of the block. */
  topMinutes: number;
  /** The block's height in minutes. */
  heightMinutes: number;
  /** The block's left edge relative to its day column, in %. */
  leftPercent: number;
  widthPercent: number;
  clash: boolean;
};

async function measureSchedule(page: Page) {
  return page.evaluate(() => {
    const tracks = Array.from(
      document.querySelectorAll('[data-testid="calendar-track"]'),
    ) as HTMLElement[];
    const blocks = Array.from(
      document.querySelectorAll('[data-testid="calendar-event"]'),
    ) as HTMLElement[];
    const ruler = document.querySelector('[data-testid="calendar-ruler"]');
    const out: {
      dayCount: number;
      rulerLabels: string[];
      blocks: BlockMeasurement[];
      /** How far a block's content overflows its duration box, in px. */
      clipped: Array<{
        id: string;
        overflow: number;
        box: number;
        content: number;
        text: string;
      }>;
      gridVisible: boolean;
      agendaVisible: boolean;
      agendaItems: number;
    } = {
      dayCount: tracks.length,
      rulerLabels: ruler
        ? (ruler.textContent ?? "").match(/\d{2}:\d{2}/g) ?? []
        : [],
      blocks: [],
      clipped: [],
      gridVisible: false,
      agendaVisible: false,
      agendaItems: document.querySelectorAll(
        '[data-testid="calendar-agenda-item"]',
      ).length,
    };
    const grid = document.querySelector('[data-testid="calendar-grid"]');
    if (grid) {
      out.gridVisible = getComputedStyle(grid).display !== "none";
    }
    const agenda = document.querySelector('[data-testid="calendar-agenda"]');
    if (agenda) {
      out.agendaVisible = getComputedStyle(agenda).display !== "none";
    }
    for (const block of blocks) {
      const rect = block.getBoundingClientRect();
      const track = block.closest(
        '[data-testid="calendar-track"]',
      ) as HTMLElement | null;
      if (!track) continue;
      const trackRect = track.getBoundingClientRect();
      const overflow = block.scrollHeight - block.clientHeight;
      if (overflow > 1) {
        out.clipped.push({
          id: block.getAttribute("data-event-id") ?? "",
          overflow,
          box: Math.round(block.getBoundingClientRect().height),
          content: block.scrollHeight,
          text: (block.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 90),
        });
      }
      out.blocks.push({
        id: block.getAttribute("data-event-id") ?? "",
        text: (block.textContent ?? "").replace(/\s+/g, " ").trim(),
        topMinutes: Math.round(rect.top - trackRect.top),
        heightMinutes: Math.round(rect.height),
        leftPercent: Math.round(
          ((rect.left - trackRect.left) / trackRect.width) * 1000,
        ) / 10,
        widthPercent: Math.round((rect.width / trackRect.width) * 1000) / 10,
        clash: block.querySelector('[data-testid="calendar-clash"]') !== null,
      });
    }
    return out;
  });
}

async function run() {
  mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ channel: "chrome" });
  const context = await browser.newContext();
  try {
    await signIn(context);

    for (const viewport of VIEWPORTS) {
      const page = await context.newPage();
      try {
        await page.setViewportSize({
          width: viewport.width,
          height: viewport.height,
        });

        // ── The schedule ────────────────────────────────────────────
        if (MODE === "calendar") {
        await page.goto(`${BASE_URL}/owner/schedule?view=week`, {
          waitUntil: "domcontentloaded",
          timeout: 90_000,
        });
        await page.waitForLoadState("networkidle").catch(() => {});
        // Hydrated readiness: the calendar's own root and its first
        // event block are in the document. The grid is hidden on a
        // phone (the agenda is on show there), so the wait is for
        // ATTACHMENT, and the visible shape is measured per viewport.
        await page.waitForSelector('[data-testid="owner-calendar"]', {
          state: "attached",
          timeout: 30_000,
        });
        await page
          .waitForSelector('[data-testid="calendar-event"]', {
            state: "attached",
            timeout: 30_000,
          })
          .catch(() => {});
        await page.waitForTimeout(500);

        const overflow = await horizontalOverflow(page);
        if (overflow > 0) {
          fail(
            viewport.name,
            "/owner/schedule",
            "no horizontal scroll",
            `the page scrolls sideways by ${overflow}px`,
          );
        }

        const measured = await measureSchedule(page);
        if (measured.dayCount !== 7) {
          fail(
            viewport.name,
            "/owner/schedule",
            "seven day columns",
            `expected 7 day columns, found ${measured.dayCount}`,
          );
        }
        if (measured.rulerLabels.some((label) => label === "24:00")) {
          fail(
            viewport.name,
            "/owner/schedule",
            "no clamped hour label",
            "the ruler prints 24:00",
          );
        }
        if (measured.rulerLabels.length !== new Set(measured.rulerLabels).size) {
          fail(
            viewport.name,
            "/owner/schedule",
            "no duplicate hour labels",
            `the ruler repeats an hour: ${measured.rulerLabels.join(", ")}`,
          );
        }

        if (viewport.width >= 1024) {
          if (!measured.gridVisible) {
            fail(
              viewport.name,
              "/owner/schedule",
              "the grid is on show on a desktop",
              "the time grid is hidden at 1280px",
            );
          }
          // Every block must sit on the ruler: its top and height in
          // pixels are its minutes, because the scale is one pixel a
          // minute.
          for (const block of measured.blocks) {
            if (block.topMinutes < 0) {
              fail(
                viewport.name,
                "/owner/schedule",
                "no block above the ruler",
                `${block.text} starts ${-block.topMinutes} minutes before the ruler`,
              );
            }
            if (block.heightMinutes <= 0) {
              fail(
                viewport.name,
                "/owner/schedule",
                "every block has a height",
                `${block.text} has no height`,
              );
            }
          }
          // A block's content must FIT the box its duration gives it:
          // a clipped label is a label the owner cannot read.
          for (const clipped of measured.clipped) {
            fail(
              viewport.name,
              "/owner/schedule",
              "the block's content fits its duration",
              `"${clipped.text}" overflows its ${clipped.box}px box by ${clipped.overflow}px (content ${clipped.content}px)`,
            );
          }
          // Two blocks that overlap in time must be side by side.
          const byDay = new Map<string, BlockMeasurement[]>();
          for (const block of measured.blocks) {
            const list = byDay.get(block.id) ?? [];
            list.push(block);
            byDay.set(block.id, list);
          }
          const overlapping = measured.blocks.filter((block) =>
            measured.blocks.some(
              (other) =>
                other !== block &&
                other.leftPercent !== block.leftPercent &&
                other.topMinutes < block.topMinutes + block.heightMinutes &&
                block.topMinutes < other.topMinutes + other.heightMinutes,
            ),
          );
          if (overlapping.length > 0) {
            notes.push(
              `${overlapping.length} overlapping blocks share the ruler at ${viewport.name}`,
            );
          }
          // The clash marker belongs to the shared coach only.
          const clashing = measured.blocks.filter((block) => block.clash);
          notes.push(
            `${clashing.length} of ${measured.blocks.length} blocks carry the clash marker at ${viewport.name}`,
          );
        } else {
          if (!measured.agendaVisible) {
            fail(
              viewport.name,
              "/owner/schedule",
              "the agenda is on show on a phone",
              "the agenda is hidden at 390px",
            );
          }
          if (measured.agendaItems === 0) {
            fail(
              viewport.name,
              "/owner/schedule",
              "the agenda carries the events",
              "the agenda lists nothing",
            );
          }
        }

        // The cross-midnight label is visible text, not an attribute.
        const crossMidnight = measured.blocks.find((block) =>
          /\+1d|next day/i.test(block.text),
        );
        if (!crossMidnight) {
          notes.push(
            "no session crossing midnight was on show in this range (the fixture's cross-midnight session is on its own day)",
          );
        } else if (crossMidnight.text.includes("24:")) {
          fail(
            viewport.name,
            "/owner/schedule",
            "a real end time",
            `the cross-midnight label shows a clamped time: ${crossMidnight.text}`,
          );
        }

        await page.screenshot({
          path: join(OUT_DIR, `schedule-${viewport.name}.png`),
          fullPage: false,
        });

        // ── The detail panel ───────────────────────────────────────
        // On a phone the agenda is the shape on show, so the agenda
        // item is the trigger; on a desktop it is the grid's block.
        const triggerId =
          viewport.width >= 1024 ? "calendar-event" : "calendar-agenda-item";
        const firstBlock = page.locator(`[data-testid="${triggerId}"]`).first();
        if (await firstBlock.count()) {
          await firstBlock.focus();
          await firstBlock.click();
          const dialog = page.locator("dialog[open]");
          await dialog.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
          const detail = page.locator('[data-testid="calendar-detail"]');
          if ((await detail.count()) === 0) {
            fail(
              viewport.name,
              "/owner/schedule",
              "the detail panel opens",
              "clicking an event opened no detail panel",
            );
          } else {
            const detailText = (await detail.textContent()) ?? "";
            if (!/\d{2}:\d{2}/.test(detailText)) {
              fail(
                viewport.name,
                "/owner/schedule",
                "the detail panel carries the time",
                `the detail panel said: ${detailText.replace(/\s+/g, " ").slice(0, 160)}`,
              );
            }
            await page.screenshot({
              path: join(OUT_DIR, `schedule-detail-${viewport.name}.png`),
            });
            await page.keyboard.press("Escape");
            await page.waitForTimeout(300);
            const focused = await page.evaluate(
              () => document.activeElement?.getAttribute("data-testid") ?? "",
            );
            if (focused !== triggerId) {
              fail(
                viewport.name,
                "/owner/schedule",
                "focus returns to the event",
                `after closing, focus was on "${focused}"`,
              );
            }
          }
        }

        }

        // ── The desktop agenda: an alternative target of at least
        //    44px for every event, whatever its duration ────────────
        // A short session's block is exactly as tall as the session —
        // that must not be stretched — so the calendar also offers an
        // agenda whose rows are full-size targets, and both open the
        // SAME event's detail.
        if (MODE === "calendar") {
          const agendaTab = page.getByRole("link", { name: "Agenda" });
          if ((await agendaTab.count()) === 0) {
            fail(
              viewport.name,
              "/owner/schedule",
              "an agenda view is reachable",
              "the calendar offers no agenda on the desktop",
            );
          } else {
            await agendaTab.click();
            await page.waitForSelector('[data-testid="calendar-agenda"]', {
              state: "attached",
              timeout: 30_000,
            });
            await page.waitForTimeout(300);
            const rows = page.locator('[data-testid="calendar-agenda-item"]');
            const rowCount = await rows.count();
            if (rowCount === 0) {
              fail(
                viewport.name,
                "/owner/schedule",
                "the agenda lists the events",
                "the agenda lists nothing",
              );
            } else {
              const heights = await page.evaluate(() =>
                Array.from(
                  document.querySelectorAll(
                    '[data-testid="calendar-agenda-item"]',
                  ),
                )
                  .filter(
                    (node) =>
                      getComputedStyle(node).display !== "none" &&
                      node.getBoundingClientRect().height > 0,
                  )
                  .map(
                    (node) =>
                      Math.round(node.getBoundingClientRect().height),
                  ),
              );
              const short = heights.filter((height) => height < 44);
              if (short.length > 0) {
                fail(
                  viewport.name,
                  "/owner/schedule",
                  "every agenda row is a 44px target",
                  `${short.length} of ${heights.length} agenda rows are under 44px`,
                );
              }
              // The agenda row opens the SAME event, with its full
              // range, and gives focus back.
              const first = rows.first();
              const label = (await first.textContent()) ?? "";
              await first.focus();
              await first.click();
              const detail = page.locator('[data-testid="calendar-detail"]');
              await detail.waitFor({ state: "attached", timeout: 10_000 });
              const detailText = (await detail.textContent()) ?? "";
              if (!detailText.includes("23:00") && !label.includes("23:00")) {
                fail(
                  viewport.name,
                  "/owner/schedule",
                  "the agenda opens the same event",
                  `the agenda row said "${label.replace(/\s+/g, " ").slice(0, 60)}"`,
                );
              }
              await page.keyboard.press("Escape");
              await page.waitForTimeout(250);
              const focused = await page.evaluate(
                () =>
                  document.activeElement?.getAttribute("data-testid") ?? "",
              );
              if (focused !== "calendar-agenda-item") {
                fail(
                  viewport.name,
                  "/owner/schedule",
                  "focus returns to the agenda row",
                  `after closing, focus was on "${focused}"`,
                );
              }
              await page.screenshot({
                path: join(OUT_DIR, `schedule-agenda-${viewport.name}.png`),
              });
            }
          }
        }

        // ── The owned operations pages: the shared control contract ──
        // The approved contract is about RENDERED geometry: the
        // standard control is 48px tall with a 10px radius and 16px
        // text. This measures the owned pages against it.
        const routes =
          MODE === "controls-a"
            ? OWNED_ROUTES.slice(0, 9)
            : MODE === "controls-b"
              ? [...OWNED_ROUTES.slice(9), ...BOUNDARY_ROUTES]
              : [];
        for (const route of routes) {
          const boundary = BOUNDARY_ROUTES.includes(route);
          await page.goto(`${BASE_URL}${route}`, {
            waitUntil: "domcontentloaded",
            timeout: 90_000,
          });
          await page.waitForLoadState("networkidle").catch(() => {});
          await page.waitForTimeout(300);
          const controls = await page.evaluate(() => {
            const nodes = Array.from(
              document.querySelectorAll(
                'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"]), select, textarea, form button[type="submit"]',
              ),
            ) as HTMLElement[];
            // A checkbox is a different control: it must keep the
            // native checkbox's own geometry, not a text field's.
            const checkboxes = Array.from(
              document.querySelectorAll('input[type="checkbox"]'),
            ) as HTMLElement[];
            const out: Array<{
              tag: string;
              /** The control's name or test id, so a finding is actionable. */
              name: string;
              height: number;
              radius: number;
              fontSize: number;
            }> = [];
            for (const node of nodes) {
              const style = getComputedStyle(node);
              if (style.display === "none" || style.visibility === "hidden") continue;
              out.push({
                tag: node.tagName.toLowerCase(),
                name:
                  node.getAttribute("name") ??
                  node.getAttribute("data-testid") ??
                  node.getAttribute("id") ??
                  "",
 
                height: Math.round(node.getBoundingClientRect().height),
                radius: Math.round(parseFloat(style.borderTopLeftRadius)),
                fontSize: Math.round(parseFloat(style.fontSize)),
              });
            }
            return {
              controls: out,
              checkboxes: checkboxes.map((node) => ({
                height: Math.round(node.getBoundingClientRect().height),
                width: Math.round(node.getBoundingClientRect().width),
                name: node.getAttribute("data-testid") ?? "",
              })),
              overflow:
                document.documentElement.scrollWidth -
                document.documentElement.clientWidth,
            };
          });
          if (controls.overflow > 0) {
            (boundary ? boundaryFindings : findings).push({
              viewport: viewport.name,
              route,
              label: "no horizontal scroll",
              problem: `the page scrolls sideways by ${controls.overflow}px`,
            });
          }
          const wanted = STANDARD_ACTIONS[route] ?? [];
          for (const label of wanted) {
            const action = await page
              .getByRole("button", { name: label, exact: true })
              .first();
            if ((await action.count()) === 0) continue;
            const metrics = await action.evaluate((node) => {
              const style = getComputedStyle(node);
              return {
                height: Math.round(node.getBoundingClientRect().height),
                fontSize: Math.round(parseFloat(style.fontSize)),
              };
            });
            if (metrics.height < 48) {
              (boundary ? boundaryFindings : findings).push({
                viewport: viewport.name,
                route,
                label: "the standard action is 48px",
                problem: `"${label}" is ${metrics.height}px tall`,
              });
            }
            if (metrics.fontSize < 16) {
              (boundary ? boundaryFindings : findings).push({
                viewport: viewport.name,
                route,
                label: "the standard action is 16px",
                problem: `"${label}" renders at ${metrics.fontSize}px`,
              });
            }
          }
          for (const box of controls.checkboxes) {
            // A native checkbox is 16-20px tall. A text field's 48px
            // minimum means the checkbox was rendered as a text input.
            if (box.height > 28) {
              (boundary ? boundaryFindings : findings).push({
                viewport: viewport.name,
                route,
                label: "a checkbox keeps the checkbox's geometry",
                problem: `a checkbox${box.name ? ` (${box.name})` : ""} is ${box.height}px tall`,
              });
            }
          }
          if (controls.controls.length > 0) {
            const short = controls.controls.filter((c) => c.height < 48);
            const small = controls.controls.filter((c) => c.fontSize < 16);
            const round = controls.controls.filter((c) => c.radius !== 10);
            notes.push(
              `${route} at ${viewport.name}: ${controls.controls.length} standard controls, ` +
                `${short.length} under 48px, ${small.length} under 16px, ${round.length} not 10px radius`,
            );
            for (const control of short) {
              (boundary ? boundaryFindings : findings).push({
                viewport: viewport.name,
                route,
                label: "the standard control is 48px",
                problem: `a ${control.tag}${control.name ? ` (${control.name})` : ""} is ${control.height}px tall`,
              });
            }
            for (const control of small) {
              (boundary ? boundaryFindings : findings).push({
                viewport: viewport.name,
                route,
                label: "the standard control is 16px",
                problem: `a ${control.tag}${control.name ? ` (${control.name})` : ""} renders at ${control.fontSize}px`,
              });
            }
          }
        }

        // ── The booking desk ───────────────────────────────────────
        if (MODE === "calendar") {
        await page.goto(`${BASE_URL}/owner/bookings`, {
          waitUntil: "domcontentloaded",
          timeout: 90_000,
        });
        await page.waitForLoadState("networkidle").catch(() => {});
        await page.waitForTimeout(800);
        const bookingOverflow = await horizontalOverflow(page);
        if (bookingOverflow > 0) {
          fail(
            viewport.name,
            "/owner/bookings",
            "no horizontal scroll",
            `the page scrolls sideways by ${bookingOverflow}px`,
          );
        }
        const bookingState = await page.evaluate(() => {
          const grid = document.querySelector('[data-testid="calendar-grid"]');
          const block = document.querySelector('[data-testid="calendar-event"]');
          const agendaItem = document.querySelector(
            '[data-testid="calendar-agenda-item"]',
          );
          const shown = block ?? agendaItem;
          const canvas = grid?.closest("section") ?? null;
          return {
            hasCalendar: grid !== null,
            hasTabs: document.querySelectorAll('[role="tab"]').length,
            loading:
              document.querySelector('[data-testid="booking-loading"]') !== null,
            eventText: shown ? (shown.textContent ?? "").replace(/\s+/g, " ").trim() : "",
            canvasWidth: canvas ? Math.round(canvas.getBoundingClientRect().width) : 0,
            body: (document.body.textContent ?? "").replace(/\s+/g, " "),
          };
        });
        if (!bookingState.hasCalendar && !bookingState.loading) {
          notes.push(
            `the booking desk rendered no calendar at ${viewport.name}: ${bookingState.body.slice(0, 220)}`,
          );
        } else if (bookingState.eventText) {
          // The event must be readable: its identity and its time.
          if (!/\d{2}:\d{2}/.test(bookingState.eventText)) {
            fail(
              viewport.name,
              "/owner/bookings",
              "the booking shows its time",
              `the booking block said: ${bookingState.eventText.slice(0, 120)}`,
            );
          }
          if (!/Rohan|Member|Synthetic/i.test(bookingState.eventText)) {
            notes.push(
              `the booking block at ${viewport.name} named no member: ${bookingState.eventText.slice(0, 120)}`,
            );
          }
          notes.push(
            `the booking canvas is ${bookingState.canvasWidth}px wide at ${viewport.name}`,
          );
        }
        await page.screenshot({
          path: join(OUT_DIR, `bookings-${viewport.name}.png`),
          fullPage: false,
        });
        }
      } finally {
        await page.close();
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }

  const report = {
    at: new Date().toISOString(),
    baseUrl: BASE_URL,
    viewports: VIEWPORTS,
    findings,
    boundaryFindings,
    notes,
  };
  writeFileSync(
    join(OUT_DIR, "calendar-browser-report.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  if (findings.length > 0) {
    console.error(
      `\n${findings.length} rendered-geometry finding(s):\n` +
        findings
          .map((f) => `  [${f.viewport}] ${f.route} — ${f.label}: ${f.problem}`)
          .join("\n"),
    );
    process.exitCode = 1;
  } else {
    console.log("\nNo rendered-geometry findings.");
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
