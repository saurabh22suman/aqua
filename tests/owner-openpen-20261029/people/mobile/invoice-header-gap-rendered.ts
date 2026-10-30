#!/usr/bin/env tsx
/**
 * The expanded invoice's column headers must read as separate words.
 *
 * The reviewer's capture (boards/16-invoice.png, and
 * final-states/states/{theme}/mobile-390x844/fees-invoice-expanded.png)
 * shows the mobile expanded invoice printing "AMOUNT" and "GST" flush
 * against each other, so the row reads as one word: "AMOUNTGST".
 *
 * This probe measures the RENDERED ink boxes of the two header labels
 * with a DOM Range over their text nodes — NOT the table cells, which
 * touch by construction even when the labels inside them are padded
 * apart. It reads the real invoice the fixture holds, changes nothing
 * (no DOM patching, no CSS patching, no data mutation), and writes the
 * evidence.
 *
 * What it checks, in both owner themes at 390, 1024 and 1280:
 *
 *   * the AMOUNT and GST labels are distinct ink boxes with real air
 *     between them (at least the 8px spacing step);
 *   * the line table keeps its real table semantics — one scoped
 *     column header per column;
 *   * the invoice's own figures are recorded unchanged: the line
 *     amount, the CGST/SGST split and the taxable/GST/total lines.
 *
 * All six cases are REQUIRED: a run that could not open and measure
 * the fixture's invoice has proved nothing and must not report
 * success.
 *
 * Run it against a bounded preview:
 *
 *   python3 .opencode/scripts/lane_job.py exec python3 \
 *     .opencode/scripts/owner_preview.py --port <port> --out <out> \
 *     --production -- pnpm exec tsx \
 *     tests/owner-openpen-20261029/people/mobile/invoice-header-gap-rendered.ts
 *
 * Exit code 0 means every case was measured and passed.
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BASE_URL = process.env.AQUA_E2E_BASE_URL ?? "http://127.0.0.1:3273";
const OUT = process.env.AQUA_E2E_OUT ?? ".playwright-mcp/invoice-header-gap";
const PHONE = process.env.AQUA_E2E_PHONE ?? "+919000000001";
const PIN = process.env.AQUA_E2E_PIN ?? "123456";

const THEMES = ["mint", "lavender"] as const;
const VIEWPORTS = [
  { name: "phone-390x844", width: 390, height: 844 },
  { name: "tablet-1024x768", width: 1024, height: 768 },
  { name: "desktop-1280x900", width: 1280, height: 900 },
];

/** The smallest air two header labels may have between them, in pixels. */
const MIN_HEADER_GAP = 8;
/** Sub-pixel slack for the fractional device pixel ratio. */
const GAP_SLACK = 0.5;
/** How long the expanded invoice may take to arrive, in milliseconds. */
const OPEN_TIMEOUT = 45_000;

type HeaderBox = { left: number; right: number; top: number; bottom: number };

type InvoiceGeometry = {
  opened: boolean;
  headers: Array<{
    label: string;
    scope: string | null;
    box: HeaderBox | null;
  }>;
  amountToGstGap: number | null;
  values: string[];
  overflow: number;
};

type Case = {
  theme: string;
  viewport: string;
  /** The preset the page actually rendered, read from the document. */
  appliedTheme: string | null;
  geometry: InvoiceGeometry;
  state: "measured" | "unavailable";
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

/** The ink box of an element's own text, measured with a DOM Range. */
async function measureInvoice(page: Page): Promise<InvoiceGeometry> {
  return await page.evaluate(() => {
    const overflow =
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth;
    const inkBox = (element: Element): HeaderBox | null => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return null;
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      };
    };

    // The expanded invoice's line table: the one whose headers are
    // Description, SAC, Amount and GST.
    const tables = Array.from(document.querySelectorAll("table"));
    const table = tables.find((candidate) => {
      const labels = Array.from(
        candidate.querySelectorAll("thead th"),
      ).map((cell) => (cell.textContent ?? "").trim().toLowerCase());
      return (
        labels.includes("description") &&
        labels.includes("sac") &&
        labels.includes("amount") &&
        labels.includes("gst")
      );
    });
    if (!table) {
      return {
        opened: false,
        headers: [],
        amountToGstGap: null,
        values: [],
        overflow,
      };
    }

    const headers = Array.from(table.querySelectorAll("thead th")).map(
      (cell) => ({
        label: (cell.textContent ?? "").trim(),
        scope: cell.getAttribute("scope"),
        box: inkBox(cell),
      }),
    );
    const amount = headers.find(
      (header) => header.label.toLowerCase() === "amount",
    );
    const gst = headers.find(
      (header) => header.label.toLowerCase() === "gst",
    );
    const amountToGstGap =
      amount?.box && gst?.box ? gst.box.left - amount.box.right : null;

    // The invoice's own figures, recorded exactly as the page states
    // them. Nothing here is asserted against a guess: the fixture's
    // numbers are the fixture's numbers.
    const values = Array.from(table.querySelectorAll("tbody tr"))
      .map((row) =>
        Array.from(row.querySelectorAll("td"))
          .map((cell) => (cell.textContent ?? "").replace(/\s+/g, " ").trim())
          .join(" | "),
      )
      .filter((line) => line.length > 0);

    return { opened: true, headers, amountToGstGap, values, overflow };
  });
}

async function openFirstInvoice(page: Page): Promise<boolean> {
  // The invoice ledger's own route.
  await page.goto(`${BASE_URL}/owner/fees?tab=invoices`, {
    waitUntil: "networkidle",
    timeout: 120_000,
  });
  await page.locator("main").waitFor({ timeout: 60_000 });

  const ledger = page.locator('[data-testid="invoice-ledger"]');
  if ((await ledger.count()) === 0) return false;
  const open = ledger.getByRole("button", { name: "Open", exact: true });
  if ((await open.count()) === 0) return false;
  await open.first().click();

  // The expanded invoice is a lazy chunk: wait for the REAL headers,
  // not for a fixed delay.
  await page.waitForFunction(
    () => {
      const tables = Array.from(document.querySelectorAll("table"));
      return tables.some((candidate) => {
        const labels = Array.from(
          candidate.querySelectorAll("thead th"),
        ).map((cell) => (cell.textContent ?? "").trim().toLowerCase());
        return labels.includes("amount") && labels.includes("gst");
      });
    },
    undefined,
    { timeout: OPEN_TIMEOUT },
  );
  await page
    .evaluate(() => document.fonts?.ready)
    .catch(() => {});
  // The real table, in view, for the evidence.
  await page
    .locator("table")
    .filter({ hasText: "Description" })
    .first()
    .scrollIntoViewIfNeeded()
    .catch(() => {});
  await page.waitForTimeout(200);
  return true;
}

function judge(
  geometry: InvoiceGeometry,
  requestedTheme: string,
  appliedTheme: string | null,
): {
  state: Case["state"];
  failures: string[];
} {
  const failures: string[] = [];
  // The preset the page really rendered must be the one that was
  // asked for: a mislabelled capture is a failed case, never a pass.
  if (appliedTheme !== requestedTheme) {
    failures.push(
      `the page renders the "${appliedTheme ?? "no"}" preset, not the requested "${requestedTheme}"`,
    );
  }
  if (!geometry.opened) {
    // Every case is required: a fixture that cannot be opened proves
    // nothing, and must never read as a pass.
    failures.push(
      "the fixture's invoice could not be opened, so its headers were never measured",
    );
    return { state: "unavailable", failures };
  }
  const unscoped = geometry.headers.filter(
    (header) => header.scope !== "col",
  );
  if (unscoped.length > 0) {
    failures.push(
      `the line table's column headers are not scoped to their column (${unscoped
        .map((header) => header.label)
        .join(", ")})`,
    );
  }
  if (geometry.amountToGstGap === null) {
    failures.push(
      "the AMOUNT and GST headers could not be measured as separate ink boxes",
    );
  } else if (geometry.amountToGstGap < MIN_HEADER_GAP - GAP_SLACK) {
    failures.push(
      `the AMOUNT and GST headers are ${geometry.amountToGstGap.toFixed(2)}px apart; they read as one word ("AMOUNTGST") below ${MIN_HEADER_GAP}px`,
    );
  }
  if (geometry.overflow > 1) {
    failures.push(
      `the page overflows horizontally by ${geometry.overflow}px`,
    );
  }
  return { state: "measured", failures };
}

async function main(): Promise<number> {
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
        let geometry: InvoiceGeometry;
        let appliedTheme: string | null = null;
        try {
          const opened = await openFirstInvoice(page);
          // The preset the document really carries.
          appliedTheme = await page.evaluate(() =>
            document.documentElement.getAttribute("data-theme"),
          );
          geometry = opened
            ? await measureInvoice(page)
            : {
                opened: false,
                headers: [],
                amountToGstGap: null,
                values: [],
                overflow: 0,
              };
        } catch (error) {
          geometry = {
            opened: false,
            headers: [],
            amountToGstGap: null,
            values: [],
            overflow: 0,
          };
          const verdict = judge(geometry, theme, appliedTheme);
          cases.push({
            theme,
            viewport: viewport.name,
            appliedTheme,
            geometry,
            state: verdict.state,
            failures: [
              `the invoice could not be read: ${String(error).slice(0, 400)}`,
              ...verdict.failures,
            ],
          });
          await context.close();
          continue;
        }
        const verdict = judge(geometry, theme, appliedTheme);
        cases.push({
          theme,
          viewport: viewport.name,
          appliedTheme,
          geometry,
          state: verdict.state,
          failures: verdict.failures,
        });
        await page.screenshot({
          path: join(OUT, `${theme}-${viewport.width}-invoice-expanded.png`),
          fullPage: false,
        });
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  writeFileSync(
    join(OUT, "invoice-header-gap.json"),
    `${JSON.stringify({ at: new Date().toISOString(), cases }, null, 2)}\n`,
  );

  let failed = false;
  for (const item of cases) {
    if (item.failures.length > 0) {
      failed = true;
      console.log(
        `CHANGES REQUIRED invoice/${item.theme}/${item.viewport}: ${item.failures.join("; ")}`,
      );
    }
  }
  // Every case is required: a run that measured none of them has
  // proved nothing and must not report success.
  const measured = cases.filter((item) => item.state === "measured").length;
  if (measured < cases.length) {
    failed = true;
    console.log(
      `CHANGES REQUIRED invoice: only ${measured}/${cases.length} cases measured a line table`,
    );
  }
  console.log(
    `invoice header gap: ${measured}/${cases.length} measured; ${failed ? "CHANGES REQUIRED" : "PASS"}`,
  );
  return failed ? 1 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error) => {
    console.error(`INVOICE HEADER PROBE STOP: ${String(error).slice(0, 800)}`);
    process.exitCode = 1;
  });
