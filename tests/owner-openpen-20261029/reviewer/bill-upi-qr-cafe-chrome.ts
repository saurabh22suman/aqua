#!/usr/bin/env tsx
/**
 * Reviewer-owned, read-only Chrome acceptance for the bill-linked UPI QR on
 * the Cafe and Booking counters.
 *
 * Scoped feature QA, not a source seal or full Owner acceptance. It performs
 * a bounded fixture-only "Request bill" on the disposable Release database
 * (the server issues the synthetic invoice exactly as the product does), then
 * opens the real UPI QR. It NEVER records a payment, reverses funds, opens a
 * upi:// link, changes actor credentials or touches real data.
 *
 * Run only through lane_job.py + owner_preview.py (dev), after root's
 * source-ready signal:
 *   AQUA_BILL_UPI_CAFE_FIXTURE=.playwright-mcp/bill-upi-qr-cafe-fixture/fixture.json \
 *   AQUA_E2E_OUT=.playwright-mcp/bill-upi-qr-cafe \
 *   node --experimental-strip-types \
 *     tests/owner-openpen-20261029/reviewer/bill-upi-qr-cafe-chrome.ts
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright";
import {
  readApprovedReceiver,
  readBillSnapshot,
  readBookingSnapshot,
  recordServerInvoices,
  type CafeFixtureManifest,
// @ts-expect-error — Node strip-types requires the explicit .ts specifier.
} from "./bill-upi-qr-cafe-fixture.ts";

const ROOT = process.cwd();
const BASE_URL = process.env.AQUA_E2E_BASE_URL ?? "http://127.0.0.1:3275";
const OUT_DIR = resolve(ROOT, process.env.AQUA_E2E_OUT ?? ".playwright-mcp/bill-upi-qr-cafe");
if (!relative(ROOT, OUT_DIR).startsWith(".playwright-mcp")) {
  throw new Error("Cafe/Booking evidence must stay under ignored .playwright-mcp/");
}
const THEMES = ["mint", "lavender"] as const;
const VIEWPORTS = [
  { name: "mobile-390x844", width: 390, height: 844 },
  { name: "desktop-1280x900", width: 1280, height: 900 },
] as const;
const PIN = process.env.AQUA_E2E_PIN ?? "123456";
const BUDGET_MS = 180_000;

type Theme = (typeof THEMES)[number];
type Viewport = (typeof VIEWPORTS)[number];
type Check = { name: string; pass: boolean | null; detail: string };
type RunRecord = {
  surface: "cafe" | "booking";
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
  qr?: {
    account: string;
    amount: string;
    invoice: string;
    invoiceId: string | null;
    expectedUri: string;
    svgPaths: number;
  };
};

const records: RunRecord[] = [];

function moneyToPaise(value: string): number | null {
  const text = value.replace(/[₹,\s]/g, "");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

function upiAmount(paise: number): string {
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, "0")}`;
}

function expectedUpiUri(
  receiver: { vpa: string; payeeName: string },
  paise: number,
): string {
  return `upi://pay?pa=${receiver.vpa}&pn=${encodeURIComponent(receiver.payeeName)}&cu=INR&am=${upiAmount(paise)}`;
}

function qrPaths(svg: string): string[] {
  return [...svg.matchAll(/<path[^>]*\bd="([^"]+)"/g)].map((match) => match[1] ?? "");
}

/**
 * The rendered local clock of an instant, exactly as the day board prints it
 * (lib/time/tz.ts formats every booking time in IST).
 */
function istClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kolkata",
  });
}

/**
 * The one booking row that belongs to this fixture: the same facility, the
 * same day, the same member, the exact rendered local start/end and the same
 * price. Picking the first row in the DOM could bill somebody else's seeded
 * booking, so the match has to be unique before anything is clicked.
 */
async function findFixtureBookingRow(
  page: Page,
  fixture: CafeFixtureManifest,
): Promise<{ row: Locator | null; matches: number; detail: string }> {
  const booking = fixture.booking;
  if (!booking) {
    return { row: null, matches: 0, detail: "the fixture has no synthetic booking" };
  }
  const rows = page.locator('[data-testid="booking-row"]');
  const total = await rows.count();
  const expectedRange = `${istClock(booking.startsAt)}\u2013${istClock(booking.endsAt)}`;
  const matched: Locator[] = [];
  const seen: string[] = [];
  for (let index = 0; index < total; index += 1) {
    const row = rows.nth(index);
    const text = (await row.innerText()).replace(/\s+/g, " ").trim();
    if (!text.includes(expectedRange)) continue;
    if (!text.includes(booking.facilityName)) continue;
    if (fixture.memberName && !text.includes(fixture.memberName)) continue;
    const shown = /₹\s?([\d,]+(?:\.\d{1,2})?)/.exec(text)?.[1] ?? null;
    if (shown === null || moneyToPaise(shown) !== booking.pricePaise) continue;
    matched.push(row);
    seen.push(text);
  }
  const detail =
    `rows=${total}; range="${expectedRange}"; facility="${booking.facilityName}"; ` +
    `member="${fixture.memberName ?? ""}"; price=${booking.pricePaise} paise; ` +
    `matched=${matched.length}${matched.length ? ` -> "${seen[0]}"` : ""}`;
  return {
    row: matched.length === 1 ? (matched[0] ?? null) : null,
    matches: matched.length,
    detail,
  };
}

async function signIn(
  context: BrowserContext,
  phone: string,
  theme: Theme,
): Promise<void> {
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    const submit = page.locator("form button[type=submit]");
    for (let attempt = 0; attempt < 8; attempt++) {
      await page.fill("#login-phone", phone);
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
        await context.addCookies([{ name: "aqua_theme", value: theme, url: BASE_URL }]);
        return;
      }
      await page.waitForTimeout(250);
    }
    throw new Error("synthetic sign-in did not become ready");
  } finally {
    await page.close().catch(() => {});
  }
}

async function extractQr(page: Page): Promise<{
  account: string;
  amount: string;
  invoice: string;
  invoiceId: string | null;
  paths: string[];
  width: number;
} | null> {
  const root = page.locator('[data-testid="bill-upi-qr"]').first();
  if ((await root.count()) === 0 || !(await root.isVisible().catch(() => false))) return null;
  const invoiceId = await root.getAttribute("data-invoice-id");
  const accountElement = page.locator('[data-testid="bill-upi-account"]').first();
  let account = "";
  if ((await accountElement.count()) > 0) {
    account = await accountElement.evaluate((element) => {
      const select = element as HTMLSelectElement;
      const selected = select.selectedOptions?.[0];
      return (selected?.textContent ?? select.value ?? "").replace(/\s+/g, " ").trim();
    });
  }
  if (!account) {
    const rootText = await root.innerText();
    account =
      rootText
        .split(/\n+/)
        .map((line) => line.trim())
        .find((line) => line.includes("@")) ?? "";
  }
  const amount = (await page.locator('[data-testid="bill-upi-amount"]').first().innerText()).trim();
  const invoice = (await page.locator('[data-testid="bill-upi-invoice"]').first().innerText()).trim();
  const svgLocator = root.locator("svg").first();
  await svgLocator.waitFor({ state: "visible", timeout: 10_000 });
  const info = await svgLocator.evaluate((svg) => {
    const box = svg.getBoundingClientRect();
    const attr = svg.getAttribute("width");
    return {
      svg: svg.outerHTML,
      width: attr ? Number.parseFloat(attr) : Math.round(box.width),
    };
  });
  return {
    account,
    amount,
    invoice,
    invoiceId,
    paths: qrPaths(info.svg),
    width: Math.round(info.width) || 260,
  };
}

/**
 * Bounded wait for the shared component's action. The component renders its
 * blocked reason until the recovery read is ready, so a missing action after
 * the wait is a state of the surface, never a product verdict.
 */
async function waitForShowAction(
  page: Page,
): Promise<{ available: boolean; enabled: boolean; blocked: string }> {
  const button = page.getByRole("button", { name: "Show UPI QR", exact: true }).first();
  let available = false;
  let enabled = false;
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if ((await button.count()) > 0 && (await button.isVisible().catch(() => false))) {
      available = true;
      enabled = !(await button.isDisabled().catch(() => true));
      if (enabled) break;
    }
    await page.waitForTimeout(400);
  }
  const blocked = available
    ? ""
    : await page
        .locator('[data-testid="bill-upi-blocked"]')
        .first()
        .innerText()
        .catch(() => "");
  return { available, enabled, blocked };
}

/** Click the action and read the drawn QR. */
async function openQr(
  page: Page,
): Promise<{ checks: Check[]; qr: Awaited<ReturnType<typeof extractQr>> }> {
  const checks: Check[] = [];
  const button = page.getByRole("button", { name: "Show UPI QR", exact: true }).first();
  await button.click();
  await page
    .locator('[data-testid="bill-upi-open"]')
    .waitFor({ state: "visible", timeout: 15_000 })
    .catch(() => {});
  await page
    .locator('[data-testid="bill-upi-open"] svg')
    .first()
    .waitFor({ state: "visible", timeout: 15_000 })
    .catch(() => {});
  await page.waitForTimeout(350);
  const qr = await extractQr(page).catch(() => null);
  checks.push({
    name: "bill-upi-root-rendered",
    pass: Boolean(qr),
    detail: qr ? "bill-upi-qr visible" : "bill-upi-qr missing after action",
  });
  if (qr) {
    checks.push(
      {
        name: "no-upi-anchor",
        pass: (await page.locator('[data-testid="bill-upi-qr"] a[href^="upi:"]').count()) === 0,
        detail: "QR is an SVG, not a UPI link",
      },
      {
        name: "required-wrappers",
        pass: qr.account.length > 0 && qr.amount.length > 0 && qr.invoice.length > 0,
        detail: `account="${qr.account}"; amount="${qr.amount}"; invoice="${qr.invoice}"`,
      },
    );
  }
  return { checks, qr };
}

/** The shared method picker: cafe uses a button, reception/booking a radio. */
async function chooseUpiMethod(page: Page): Promise<Check> {
  const radio = page.getByRole("radio", { name: "UPI", exact: true }).first();
  if ((await radio.count()) > 0) {
    await radio.check();
    await page.waitForTimeout(200);
    return {
      name: "upi-method-selected",
      pass: true,
      detail: "selected the UPI method radio",
    };
  }
  const button = page.getByRole("button", { name: /^UPI QR/ }).first();
  if ((await button.count()) > 0) {
    await button.click();
    await page.waitForTimeout(200);
    return {
      name: "upi-method-selected",
      pass: true,
      detail: "selected the UPI QR method button",
    };
  }
  return {
    name: "upi-method-selected",
    pass: false,
    detail: "no UPI method control rendered",
  };
}

async function verifyQrAgainstBill(
  qr: Awaited<ReturnType<typeof extractQr>>,
  billAmountPaise: number | null,
  receiver: { vpa: string; payeeName: string } | null,
  invoiceIdExpected: string | null,
): Promise<Check[]> {
  if (!qr) return [{ name: "bill-upi-qr", pass: false, detail: "QR missing" }];
  const checks: Check[] = [];
  const actualPaise = moneyToPaise(qr.amount);
  checks.push({
    name: "qr-amount-equals-bill-amount-due",
    pass:
      actualPaise !== null &&
      (billAmountPaise === null || actualPaise === billAmountPaise),
    detail: `qr="${qr.amount}" paise=${actualPaise}; bill due paise=${billAmountPaise}`,
  });
  checks.push({
    name: "qr-invoice-identity",
    pass:
      invoiceIdExpected === null ||
      qr.invoiceId === invoiceIdExpected ||
      qr.invoice.includes(invoiceIdExpected),
    detail: `qrInvoiceId=${qr.invoiceId}; expected=${invoiceIdExpected}; text="${qr.invoice}"`,
  });
  const accountVpa = qr.account.match(/[A-Za-z0-9._-]+@[A-Za-z0-9._-]+/)?.[0] ?? null;
  checks.push({
    name: "qr-receiver-account",
    pass: receiver ? accountVpa === receiver.vpa : null,
    detail: receiver
      ? `qr="${qr.account}"; expected vpa=${receiver.vpa}`
      : "no approved receiver fixture",
  });
  if (receiver && actualPaise !== null) {
    const uri = expectedUpiUri(receiver, actualPaise);
    const qrModule = await import("qrcode");
    const expectedSvg = await qrModule.toString(uri, {
      type: "svg",
      margin: 1,
      width: qr.width,
    });
    const expectedPaths = qrPaths(expectedSvg);
    checks.push({
      name: "svg-paths-match-expected-upi-uri",
      pass: expectedPaths.length > 0 && expectedPaths.join("|") === qr.paths.join("|"),
      detail: `actualPaths=${qr.paths.length}; expectedPaths=${expectedPaths.length}; uri=${uri}`,
    });
  }
  return checks;
}

/** Bounded diagnostic for a step that could not proceed: one screenshot and a
 * short page excerpt in the ignored evidence root. Never clicks anything. */
async function captureStepFailure(
  page: Page,
  record: { screenshots: string[] },
  name: string,
): Promise<void> {
  try {
    const shot = join(OUT_DIR, "bill-upi-qr-cafe", "failures", `${name}.png`);
    await mkdir(dirname(shot), { recursive: true });
    await page.screenshot({
      path: shot,
      fullPage: false,
      animations: "disabled",
      caret: "hide",
      timeout: 15_000,
    });
    record.screenshots.push(relative(ROOT, shot));
    const text = await page
      .locator("main")
      .first()
      .innerText({ timeout: 5_000 })
      .catch(() => "");
    await writeFile(
      join(dirname(shot), `${name}.txt`),
      text.replace(/\s+/g, " ").trim().slice(0, 600) + "\n",
    );
  } catch {
    // Diagnostics are best effort.
  }
}

/** The open QR panel scrolled into view, plus the separate manual recording
 * area, which is never clicked. */
async function captureQrAndManual(
  page: Page,
  record: { screenshots: string[] },
  theme: string,
  viewport: string,
  prefix: string,
): Promise<void> {
  const panel = page.locator('[data-testid="bill-upi-open"]').first();
  if ((await panel.count()) > 0) {
    await panel.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(250);
  }
  const qrShot = join(OUT_DIR, "bill-upi-qr-cafe", theme, viewport, `${prefix}-qr.png`);
  await mkdir(dirname(qrShot), { recursive: true });
  await page.screenshot({
    path: qrShot,
    fullPage: false,
    animations: "disabled",
    caret: "hide",
  });
  record.screenshots.push(relative(ROOT, qrShot));
  const manual = page.getByRole("button", { name: /Record payment/i }).first();
  if ((await manual.count()) > 0) {
    await manual.scrollIntoViewIfNeeded().catch(() => {});
    await page.waitForTimeout(250);
    const manualShot = join(
      OUT_DIR,
      "bill-upi-qr-cafe",
      theme,
      viewport,
      `${prefix}-manual-recording.png`,
    );
    await mkdir(dirname(manualShot), { recursive: true });
    await page.screenshot({
      path: manualShot,
      fullPage: false,
      animations: "disabled",
      caret: "hide",
    });
    record.screenshots.push(relative(ROOT, manualShot));
  }
}

async function runSurface(
  surface: "cafe" | "booking",
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  fixture: CafeFixtureManifest,
  theme: Theme,
  viewport: Viewport,
): Promise<RunRecord> {
  const route = surface === "cafe" ? "/reception/cafe" : "/owner/bookings";
  const record: RunRecord = {
    surface,
    theme,
    viewport: viewport.name,
    route,
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
  const add = (name: string, pass: boolean | null, detail: string) =>
    record.checks.push({ name, pass, detail });
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    colorScheme: "light",
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
  });
  try {
    const phone =
      surface === "cafe" ? fixture.actors.reception : fixture.actors.owner;
    await signIn(context, phone, theme);
    const page = await context.newPage();
    try {
      await page.goto(`${BASE_URL}${route}`, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      await page.locator("main h1").first().waitFor({ state: "visible", timeout: 30_000 });
      // Root QA adapter: allow the downloaded client island to hydrate
      // before interacting with SSR bill controls. No product behavior changes.
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

      // Cafe: the synthetic order is listed in the open-orders panel.
      // Booking: the synthetic booking is listed on the day board for its
      // facility and date, so the board is pointed at the fixture first.
      let billTrigger: Locator | null = null;
      if (surface === "cafe") {
        billTrigger = page
          .locator(
            `[data-testid="cafe-open-order-${fixture.cafe.orderId}"] button[aria-label^="Request bill"]`,
          )
          .first();
      } else {
        if (!fixture.booking) {
          record.unavailable.push("the fixture has no synthetic booking");
          return record;
        }
        const facilitySelect = page.locator('[data-testid="booking-facility"]').first();
        if ((await facilitySelect.count()) > 0) {
          await facilitySelect
            .selectOption(fixture.booking.facilityId)
            .catch(() => {});
          await page.waitForTimeout(300);
        }
        const dateInput = page.locator('[data-testid="booking-date"]').first();
        if ((await dateInput.count()) > 0) {
          await dateInput.fill(fixture.booking.dateLabel).catch(() => {});
          await dateInput.blur().catch(() => {});
          await page.waitForTimeout(400);
        }
        // The day rows only exist in the board view.
        const boardTab = page
          .getByRole("tablist", { name: "Booking view" })
          .getByRole("tab", { name: "Board", exact: true })
          .first();
        if ((await boardTab.count()) > 0) {
          await boardTab.click().catch(() => {});
          await page.waitForTimeout(500);
        }
        await page
          .locator('[data-testid="booking-day-list"]')
          .first()
          .waitFor({ state: "visible", timeout: 20_000 })
          .catch(() => {});
        await page.waitForTimeout(800);
        const found = await findFixtureBookingRow(page, fixture);
        add(
          "fixture-booking-unique-match",
          found.matches === 1 ? true : null,
          found.detail,
        );
        if (found.matches !== 1 || !found.row) {
          record.unavailable.push(
            found.matches === 0
              ? "synthetic booking is not listed on the day board"
              : "more than one booking row matched the fixture booking",
          );
          return record;
        }
        billTrigger = found.row.locator('[data-testid="booking-bill-button"]').first();
      }
      const triggerVisible =
        billTrigger !== null &&
        (await billTrigger.count()) > 0 &&
        (await billTrigger.isVisible().catch(() => false));
      add(
        "fixture-bill-trigger-visible",
        triggerVisible,
        triggerVisible
          ? "fixture bill trigger rendered"
          : "fixture bill trigger not rendered",
      );
      if (!triggerVisible || !billTrigger) {
        record.unavailable.push(
          surface === "cafe"
            ? "synthetic cafe order is not listed for this actor/location"
            : "synthetic booking has no bill action on the day board",
        );
        return record;
      }
      await billTrigger.click();

      const billPanel =
        surface === "cafe"
          ? page.locator('[data-testid="cafe-bill"]').first()
          : page.locator('[data-testid="booking-bill"]').first();
      await billPanel.waitFor({ state: "visible", timeout: 20_000 });
      const dueElement =
        surface === "cafe"
          ? page.locator('[data-testid="cafe-amount-due"]').first()
          : page.locator('[data-testid="booking-amount-due"]').first();
      const dueText = await dueElement.innerText().catch(() => "");
      // The labelled due row includes "Amount due"; parse its visible
      // rupee token rather than treating the label as part of the number.
      const visibleDue = dueText.match(/₹\s*([\d,]+(?:\.\d{1,2})?)/)?.[0] ?? "";
      const duePaise = moneyToPaise(visibleDue);
      add(
        "bill-amount-due-rendered",
        duePaise !== null && duePaise > 0,
        `due="${dueText.replace(/\s+/g, " ")}" paise=${duePaise}`,
      );
      const billShot = join(OUT_DIR, "bill-upi-qr-cafe", theme, viewport.name, `${surface}-bill.png`);
      await mkdir(dirname(billShot), { recursive: true });
      await page.screenshot({ path: billShot, fullPage: false, animations: "disabled", caret: "hide" });
      record.screenshots.push(relative(ROOT, billShot));

      const methodCheck = await chooseUpiMethod(page);
      add(methodCheck.name, methodCheck.pass, methodCheck.detail);
      if (methodCheck.pass !== true) {
        record.defects = record.checks.filter((check) => check.pass === false).map((check) => `${check.name}: ${check.detail}`);
        record.status = "CHANGES REQUIRED";
        return record;
      }

      // The shared component renders its blocked reason until the recovery
      // read is ready, so wait for the action itself before deciding anything.
      const gate = await waitForShowAction(page);
      add(
        "show-upi-action",
        gate.available ? true : null,
        gate.available
          ? "Show UPI QR rendered"
          : "Show UPI QR did not render within the bounded wait (recovery read still in flight?)",
      );
      add(
        "show-upi-enabled",
        gate.available ? gate.enabled : null,
        gate.available ? `disabled=${!gate.enabled}` : "action unavailable",
      );
      if (!gate.available || !gate.enabled) {
        add(
          "show-upi-blocked-reason",
          null,
          gate.blocked
            ? `blocked="${gate.blocked.replace(/\s+/g, " ").trim().slice(0, 200)}"`
            : "no blocked reason rendered",
        );
        await captureStepFailure(page, record, "cafe-show-upi-not-ready");
        record.unavailable = record.checks
          .filter((check) => check.pass === null)
          .map((check) => check.name);
        record.status = "UNTESTED";
        return record;
      }

      // The invoice is issued by the server's own Request bill path; capture
      // its id so cleanup and the no-money-mutation snapshot stay scoped.
      const invoiceId = await page
        .locator('[data-testid="bill-upi-qr"]')
        .first()
        .getAttribute("data-invoice-id")
        .catch(() => null);
      if (!invoiceId) {
        record.unavailable.push("server-issued invoice id not rendered");
        return record;
      }
      await recordServerInvoices([invoiceId]);

      // The booking row carries the invoice the server linked to it, so this
      // is the proof that the bill on show is this fixture's own booking and
      // not another seeded booking's.
      if (surface === "booking" && fixture.booking) {
        const bookingSnapshot = await readBookingSnapshot(
          fixture,
          fixture.booking.bookingId,
        );
        add(
          "invoice-belongs-to-the-fixture-booking",
          bookingSnapshot?.invoiceId === invoiceId,
          `booking=${fixture.booking.bookingId}; bookingInvoice=${bookingSnapshot?.invoiceId ?? "none"}; billInvoice=${invoiceId}`,
        );
      }

      const beforeShow = await readBillSnapshot(fixture, invoiceId);
      add(
        "bill-issued-not-paid",
        Boolean(beforeShow.invoice) &&
          beforeShow.invoice!.paidPaise === "0" &&
          beforeShow.payments.length === 0 &&
          beforeShow.reversals.length === 0,
        `status=${beforeShow.invoice?.status}; paid=${beforeShow.invoice?.paidPaise}/${beforeShow.invoice?.totalPaise}; payments=${beforeShow.payments.length}; reversals=${beforeShow.reversals.length}`,
      );

      const shown = await openQr(page);
      record.checks.push(...shown.checks);
      if (!shown.qr) {
        record.defects = record.checks.filter((check) => check.pass === false).map((check) => `${check.name}: ${check.detail}`);
        record.status = "CHANGES REQUIRED";
        return record;
      }
      record.qr = {
        account: shown.qr.account,
        amount: shown.qr.amount,
        invoice: shown.qr.invoice,
        invoiceId: shown.qr.invoiceId,
        expectedUri: "",
        svgPaths: shown.qr.paths.length,
      };
      const receiver = await readApprovedReceiver();
      record.checks.push(
        ...(await verifyQrAgainstBill(shown.qr, duePaise, receiver, invoiceId)),
      );
      await captureQrAndManual(page, record, theme, viewport.name, surface);

      const afterShow = await readBillSnapshot(fixture, invoiceId);
      const unchanged =
        beforeShow.invoice?.status === afterShow.invoice?.status &&
        beforeShow.invoice?.paidPaise === afterShow.invoice?.paidPaise &&
        beforeShow.invoice?.totalPaise === afterShow.invoice?.totalPaise &&
        beforeShow.payments.join("|") === afterShow.payments.join("|") &&
        beforeShow.reversals.join("|") === afterShow.reversals.join("|") &&
        beforeShow.intents.join("|") === afterShow.intents.join("|");
      add(
        "show-qr-does-not-move-money",
        unchanged,
        `before=${beforeShow.invoice?.status}/${beforeShow.invoice?.paidPaise}; after=${afterShow.invoice?.status}/${afterShow.invoice?.paidPaise}; payments=${afterShow.payments.length}; reversals=${afterShow.reversals.length}; intents=${afterShow.intents.length}`,
      );

      record.captured = record.screenshots.length > 0;
      record.tested = record.checks.filter((check) => check.pass !== null).map((check) => check.name);
      record.defects = record.checks.filter((check) => check.pass === false).map((check) => `${check.name}: ${check.detail}`);
      record.unavailable = record.checks.filter((check) => check.pass === null).map((check) => check.name);
      record.status = record.defects.length
        ? "CHANGES REQUIRED"
        : record.unavailable.length
          ? "UNTESTED"
          : "CAPTURED";
      return record;
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    await context.close().catch(() => {});
  }
}

const started = Date.now();
const fixturePath = process.env.AQUA_BILL_UPI_CAFE_FIXTURE ??
  ".playwright-mcp/bill-upi-qr-cafe-fixture/fixture.json";
const fixture = JSON.parse(
  await readFile(resolve(process.cwd(), fixturePath), "utf8"),
) as CafeFixtureManifest;

const browser = await chromium.launch({ channel: "chrome", headless: true });
let fatal: string | null = null;
try {
  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      for (const surface of ["cafe", "booking"] as const) {
        try {
          records.push(await runSurface(surface, browser, fixture, theme, viewport));
        } catch (error) {
          records.push({
            surface,
            theme,
            viewport: viewport.name,
            route: surface === "cafe" ? "/reception/cafe" : "/owner/bookings",
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
  }
} catch (error) {
  fatal = String(error).slice(0, 1200);
} finally {
  await browser.close().catch(() => {});
}

const summary = {
  driver: "bill-upi-qr-cafe-chrome",
  startedAt: new Date(started).toISOString(),
  durationMs: Date.now() - started,
  baseUrl: BASE_URL,
  budgetMs: BUDGET_MS,
  withinBudget: Date.now() - started <= BUDGET_MS,
  fixtureNamespace: fixture.namespace,
  surfaces: ["cafe", "booking"],
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
    "Bounded fixture-only Request bill: the server issues the synthetic invoice; no payment is recorded.",
    "No payment, reversal, intent, UPI link, transfer, credential or settings write is performed.",
    "The only database access is read-only, tenant-scoped snapshots of the synthetic invoice.",
    "Physical phone/bank scans and real UPI apps remain NOT TESTED.",
  ],
};

await mkdir(OUT_DIR, { recursive: true });
await writeFile(
  join(OUT_DIR, "summary-bill-upi-qr-cafe.json"),
  JSON.stringify(summary, null, 2) + "\n",
);
console.log(
  `cafe/booking bill upi qr: ${summary.summary.captured}/${summary.summary.records} captured; ` +
    `${summary.summary.changesRequired} CHANGES REQUIRED; ${summary.summary.blocked} BLOCKED; ` +
    `${summary.summary.untested} UNTESTED; ${summary.durationMs}ms`,
);
if (
  fatal ||
  records.length === 0 ||
  records.some(
    (record) =>
      record.status !== "CAPTURED" ||
      record.checks.some((check) => check.pass === null),
  )
) {
  process.exitCode = 1;
}
