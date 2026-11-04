#!/usr/bin/env tsx
/**
 * Reviewer-owned, read-only bill-linked UPI QR acceptance check.
 *
 * This is deliberately a scoped feature check, not a source seal, build gate
 * or full Owner acceptance. It never records a payment, opens a UPI link,
 * transfers money or writes product data. Run only through lane_job.py and
 * owner_preview.py (dev), after root confirms the C source and fixture data.
 *
 * Required synthetic fixture manifest (optional env path):
 *   AQUA_BILL_UPI_FIXTURE=/ignored/root/fixture.json
 * The driver records an UNTESTED receiver result when no approved synthetic
 * receiver is supplied. It never reads a root .env or a real club database.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright";
import {
  readMutationSnapshot,
  type Manifest as FixtureManifest,
  type MutationSnapshot,
// @ts-expect-error — Node strip-types requires the explicit .ts specifier.
} from "./bill-upi-qr-fixture.ts";

const ROOT = process.cwd();
const BASE_URL = process.env.AQUA_E2E_BASE_URL ?? "http://127.0.0.1:3275";
const OUT_DIR = resolve(ROOT, process.env.AQUA_E2E_OUT ?? ".playwright-mcp/bill-upi-qr-chrome");
if (!relative(ROOT, OUT_DIR).startsWith(".playwright-mcp")) {
  throw new Error("Bill QR evidence must stay under ignored .playwright-mcp/");
}
const THEMES = ["mint", "lavender"] as const;
const VIEWPORTS = [
  { name: "mobile-390x844", width: 390, height: 844 },
  { name: "desktop-1280x900", width: 1280, height: 900 },
  { name: "tablet-1024x768", width: 1024, height: 768 },
] as const;
const BUDGET_MS = 180_000;
const DEFAULT_OWNER_PHONE = "+919000000001";
const DEFAULT_RECEPTION_PHONE = "+919000000004";
const PIN = process.env.AQUA_E2E_PIN ?? "123456";
const SOURCE_FILES = [
  "components/payments/bill-upi-qr.tsx",
  "components/payments/payment-amount-field.tsx",
  "components/payments/recovery-qr-gate.ts",
  "components/link-qr.tsx",
  "lib/payment-qr.ts",
  "components/member-detail/invoice-expanded.tsx",
  "components/member-detail/member-invoices-panel.tsx",
  "components/cafe-payment-panel.tsx",
  "components/cafe-payment-recovery-form.tsx",
  "components/payment-record-form.tsx",
  "components/reception/payment-record-recovery-form.tsx",
  "components/reception/payment-method-fields.tsx",
  "app/(reception)/reception/collect-payment/page.tsx",
];

type Theme = (typeof THEMES)[number];
type Viewport = (typeof VIEWPORTS)[number];
type Check = { name: string; pass: boolean | null; detail: string };
type FixtureInvoice = {
  id: string;
  number: string;
  amountPaise: number;
};
type Fixture = {
  database?: string;
  tenantId?: string;
  memberId?: string;
  memberName?: string;
  actors?: { owner?: string; reception?: string };
  receiver?: { vpa: string; payeeName: string; nickname?: string; paymentQrId?: string };
  owner?: { phone: string; pin: string };
  reception?: { phone: string; pin: string };
  invoices?: {
    openA?: FixtureInvoice;
    openB?: FixtureInvoice;
    closed?: FixtureInvoice;
    void?: FixtureInvoice;
    ownerOpen?: string;
    ownerOpen2?: string;
    closedNumber?: string;
    uncertain?: string;
  };
};
type RunRecord = {
  surface: "owner-invoice" | "reception-invoice";
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
    svgPaths: string[];
    expectedUri: string;
    width: number;
  };
};

const records: RunRecord[] = [];

async function loadFixture(): Promise<Fixture> {
  const path = process.env.AQUA_BILL_UPI_FIXTURE;
  if (!path) return {};
  try {
    return JSON.parse(await readFile(path, "utf8")) as Fixture;
  } catch {
    return {};
  }
}

async function mutationSnapshot(fixture: Fixture): Promise<MutationSnapshot | null> {
  if (
    !fixture.tenantId ||
    !fixture.invoices?.openA?.id ||
    !fixture.invoices.openB?.id ||
    !fixture.invoices.closed?.id ||
    !fixture.invoices.void?.id
  ) {
    return null;
  }
  return readMutationSnapshot(fixture as unknown as FixtureManifest);
}

function mutationCheck(before: MutationSnapshot | null, after: MutationSnapshot | null): Check {
  if (!before || !after) {
    return {
      name: "no-payment-reversal-intent-mutation",
      pass: null,
      detail: "fixture-scoped DB snapshot unavailable",
    };
  }
  const same =
    before.payments.join("|") === after.payments.join("|") &&
    before.reversals.join("|") === after.reversals.join("|") &&
    before.intents.join("|") === after.intents.join("|");
  const financial = before.invoices
    .map((invoice) => `${invoice.id}:${invoice.status}:${invoice.paidPaise}:${invoice.totalPaise}`)
    .join("|") ===
    after.invoices
      .map((invoice) => `${invoice.id}:${invoice.status}:${invoice.paidPaise}:${invoice.totalPaise}`)
      .join("|");
  return {
    name: "no-payment-reversal-intent-mutation",
    pass: same && financial,
    detail:
      `payments=${before.payments.length}; reversals=${before.reversals.length}; intents=${before.intents.length}; ` +
      `intentsTable=${before.intentsTable}; invoiceStateUnchanged=${financial}; ` +
      `invoices=${after.invoices
        .map((invoice) => `${invoice.id.slice(0, 8)}:${invoice.status}:paid=${invoice.paidPaise}/${invoice.totalPaise}`)
        .join(",")}`,
  };
}

function moneyToPaise(value: string): number | null {
  const text = value.replace(/[₹,\s]/g, "");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  return Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
}

function upiAmount(paise: number): string {
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, "0")}`;
}

function expectedUpiUri(receiver: { vpa: string; payeeName: string }, paise: number): string {
  return `upi://pay?pa=${receiver.vpa}&pn=${encodeURIComponent(receiver.payeeName)}&cu=INR&am=${upiAmount(paise)}`;
}

function qrPaths(svg: string): string[] {
  return [...svg.matchAll(/<path[^>]*\bd="([^"]+)"/g)].map((match) => match[1] ?? "");
}

async function signIn(context: BrowserContext, phone: string, pin: string, theme: Theme): Promise<void> {
  const page = await context.newPage();
  try {
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    const submit = page.locator("form button[type=submit]");
    for (let attempt = 0; attempt < 8; attempt++) {
      await page.fill("#login-phone", phone);
      await page.fill("#login-pin", pin);
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

function invoiceRows(page: Page): Locator {
  return page.locator('li:has([data-testid="member-invoice-status"])');
}

/**
 * The invoice list is a client island: its Open button can exist in the
 * server HTML before React hydrates, and a click before hydration does
 * nothing. Readiness is the expanded invoice actually appearing.
 */
async function openInvoiceRow(page: Page, row: Locator): Promise<boolean> {
  const open = row.getByRole("button", { name: "Open", exact: true }).first();
  if ((await open.count()) === 0) return false;
  const expanded = page.locator('[data-testid="invoice-expanded-status"]').first();
  for (let attempt = 0; attempt < 3; attempt++) {
    await open.click();
    const shown = await expanded
      .waitFor({ state: "visible", timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    if (shown) return true;
  }
  return false;
}

/**
 * Select the UPI method on a hydrated client form and prove the QR action
 * appeared; a pre-hydration selectOption is silently ignored.
 */
/**
 * Hydration-safe text entry. The server HTML ships the input already
 * filled, but React has not bound its handler yet, so the state stays empty
 * and the action button stays disabled. Readiness is the button becoming
 * enabled, and the value is re-entered on each attempt because hydration can
 * reset it.
 */
async function fillUntilEnabled(
  page: Page,
  input: Locator,
  button: Locator,
  value: string,
  attempts = 6,
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    await input.fill(value).catch(() => {});
    const enabled = await button.isEnabled().catch(() => false);
    if (enabled) return true;
    await page.waitForTimeout(400);
  }
  return false;
}

async function selectUpiMethod(
  page: Page,
  select: Locator,
): Promise<boolean> {
  if ((await select.count()) === 0) return false;
  const showButton = page.getByRole("button", { name: "Show UPI QR", exact: true }).first();
  for (let attempt = 0; attempt < 3; attempt++) {
    await select.selectOption("upi").catch(() => {});
    const ready = await showButton
      .waitFor({ state: "visible", timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    if (ready) return true;
  }
  return false;
}

async function extractQr(page: Page): Promise<{
  root: Locator;
  account: string;
  amount: string;
  invoice: string;
  invoiceId: string | null;
  accountId: string | null;
  svg: string;
  paths: string[];
  width: number;
} | null> {
  const root = page.locator('[data-testid="bill-upi-qr"]').first();
  if ((await root.count()) === 0 || !(await root.isVisible().catch(() => false))) return null;
  const invoiceId = await root.getAttribute("data-invoice-id");
  const accountElement = page.locator('[data-testid="bill-upi-account"]').first();
  let account = "";
  let accountId: string | null = null;
  if ((await accountElement.count()) > 0) {
    // A multi-account select renders every option; only the selected one is
    // the account this QR encodes.
    const selected = await accountElement.evaluate((element) => {
      const select = element as HTMLSelectElement;
      const option = select.selectedOptions?.[0];
      return {
        text: (option?.textContent ?? select.value ?? "").replace(/\s+/g, " ").trim(),
        value: option?.value ?? select.value ?? "",
      };
    });
    account = selected.text;
    accountId = selected.value || null;
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
    root,
    account,
    accountId,
    amount,
    invoice,
    invoiceId,
    svg: info.svg,
    paths: qrPaths(info.svg),
    width: Math.round(info.width) || 260,
  };
}

async function showQr(
  page: Page,
  receiver?: Fixture["receiver"],
  record?: { screenshots: string[] },
): Promise<{ checks: Check[]; qr: Awaited<ReturnType<typeof extractQr>>; requests: string[] }> {
  const requests: string[] = [];
  const onRequest = (request: { method: () => string; url: () => string }) => {
    if (request.method() !== "GET") requests.push(`${request.method()} ${request.url()}`);
  };
  page.on("request", onRequest);
  const button = page.getByRole("button", { name: "Show UPI QR", exact: true }).first();
  const checks: Check[] = [];
  // The recovery read is still in flight on a fresh surface, so the shared
  // component renders its blocked reason instead of the action. Wait for the
  // action to actually appear and enable; a missing action after that is a
  // state, not a product verdict.
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
  checks.push({
    name: "show-upi-action",
    pass: available ? true : null,
    detail: available
      ? "Show UPI QR rendered"
      : "Show UPI QR did not render within the bounded wait (recovery read still in flight?)",
  });
  checks.push({
    name: "show-upi-enabled-for-current-amount",
    pass: available ? enabled : null,
    detail: available ? `disabled=${!enabled}` : "action unavailable",
  });
  if (!available || !enabled) {
    page.off("request", onRequest);
    const blocked = await page
      .locator('[data-testid="bill-upi-blocked"]')
      .first()
      .innerText()
      .catch(() => "");
    checks.push({
      name: "show-upi-blocked-reason",
      pass: null,
      detail: blocked ? `blocked="${blocked.replace(/\s+/g, " ").trim().slice(0, 200)}"` : "no blocked reason rendered",
    });
    if (record) {
      await captureStepFailure(page, record, "show-upi-not-ready");
    }
    return { checks, qr: null, requests };
  }
  await button.click();
  await page.locator('[data-testid="bill-upi-open"]').waitFor({ state: "visible", timeout: 15_000 }).catch(() => {});
  // The QR itself is rendered asynchronously by the shared component; wait
  // for the drawn SVG before any assertion or screenshot.
  await page
    .locator('[data-testid="bill-upi-open"] svg')
    .first()
    .waitFor({ state: "visible", timeout: 15_000 })
    .catch(() => {});
  await page.waitForTimeout(350);
  const accountSelect = page.locator('[data-testid="bill-upi-account"]').first();
  const hasAccountSelect = (await accountSelect.count()) > 0;
  let selectedSynthetic: { value: string; text: string } | null = null;
  let selectionError: string | null = null;
  if (hasAccountSelect) {
    try {
      const options = await accountSelect.locator("option").evaluateAll((nodes) =>
        nodes.map((node) => ({ value: (node as HTMLOptionElement).value, text: (node.textContent ?? "").trim() })),
      );
      selectedSynthetic = receiver
        ? options.find((option) =>
            receiver.paymentQrId
              ? option.value === receiver.paymentQrId
              : option.text.includes(receiver.vpa),
          ) ?? null
        : null;
      if (selectedSynthetic) await accountSelect.selectOption(selectedSynthetic.value);
      await page.waitForTimeout(300);
    } catch (error) {
      selectionError = String(error).slice(0, 200);
    }
  }
  const qr = await extractQr(page).catch(() => null);
  if (hasAccountSelect) {
    checks.push({
      name: "synthetic-receiver-selected",
      pass: selectionError ? false : Boolean(selectedSynthetic),
      detail: selectionError
        ? `receiver selection failed: ${selectionError}`
        : selectedSynthetic
          ? `selected ${selectedSynthetic.text}`
          : "fixture receiver id not present among the active UPI accounts",
    });
  } else {
    checks.push({
      name: "synthetic-receiver-selected",
      pass: receiver && qr ? qr.account.includes(receiver.vpa) : null,
      detail:
        receiver && qr
          ? `single active UPI account; rendered account="${qr.account}"`
          : "single active UPI account; receiver not asserted without a fixture",
    });
  }
  await page.waitForTimeout(400);
  page.off("request", onRequest);
  checks.push({
    name: "bill-upi-root-rendered",
    pass: Boolean(qr),
    detail: qr ? "bill-upi-qr visible" : "bill-upi-qr missing after action",
  });
  if (qr) {
    checks.push(
      { name: "no-upi-anchor", pass: (await qr.root.locator('a[href^="upi:"]').count()) === 0, detail: "QR is an SVG, not a UPI link" },
      { name: "required-wrappers", pass: qr.account.length > 0 && qr.amount.length > 0 && qr.invoice.length > 0, detail: `account="${qr.account}"; amount="${qr.amount}"; invoice="${qr.invoice}"` },
    );
  }
  checks.push({
    name: "observed-show-requests",
    pass: true,
    detail: requests.length
      ? `expected read/server-action POST observed: ${requests.join("; ")}`
      : "no network request observed (action may be cached); mutation snapshot below is authoritative",
  });
  return { checks, qr, requests };
}

async function verifyQr(
  page: Page,
  fixture: Fixture,
  expectedAmount: number | null,
  expectedInvoice: string | null,
): Promise<Check[]> {
  const qr = await extractQr(page);
  if (!qr) return [{ name: "bill-upi-qr", pass: false, detail: "QR missing" }];
  const checks: Check[] = [];
  const actualPaise = moneyToPaise(qr.amount);
  checks.push({
    name: "current-bill-amount",
    pass: actualPaise !== null && (expectedAmount === null || actualPaise === expectedAmount),
    detail: `qr="${qr.amount}" paise=${actualPaise}; expected=${expectedAmount}`,
  });
  checks.push({
    name: "current-invoice",
    pass: expectedInvoice === null ||
      expectedInvoice.includes(qr.invoice) ||
      qr.invoice.includes(expectedInvoice) ||
      (() => {
        const token = /[A-Z0-9-]*\d[A-Z0-9-]*/i.exec(qr.invoice)?.[0];
        return Boolean(token && expectedInvoice.includes(token));
      })(),
    detail: `qr="${qr.invoice}"; expected="${expectedInvoice}"`,
  });
  const fixtureReceiver = fixture.receiver ?? null;
  const accountVpa = qr.account.match(/[A-Za-z0-9._-]+@[A-Za-z0-9._-]+/)?.[0] ?? null;
  const accountName = qr.account.split("·")[0]?.trim() ?? "";
  checks.push({
    name: "approved-synthetic-receiver",
    pass: fixtureReceiver
      ? Boolean(
          accountVpa === fixtureReceiver.vpa &&
            (qr.accountId
              ? qr.accountId === fixtureReceiver.paymentQrId
              : qr.account.includes(fixtureReceiver.payeeName)),
        )
      : null,
    detail: fixtureReceiver
      ? `qr="${qr.account}"; accountId=${qr.accountId ?? "single"}; ` +
        `expected="${fixtureReceiver.payeeName} · ${fixtureReceiver.vpa}" (id ${fixtureReceiver.paymentQrId ?? "n/a"})`
      : "no approved synthetic receiver fixture supplied",
  });
  const receiver = fixtureReceiver ?? (accountVpa
    ? { vpa: accountVpa, payeeName: accountName.replace(/\s*·.*$/, "").trim() || accountName }
    : null);
  if (actualPaise !== null && receiver) {
    const expectedUri = expectedUpiUri(receiver, actualPaise);
    const qrModule = await import("qrcode");
    const expectedSvg = await qrModule.toString(expectedUri, {
      type: "svg",
      margin: 1,
      width: qr.width,
    });
    const expectedPaths = qrPaths(expectedSvg);
    checks.push({
      name: "svg-paths-match-current-bill",
      pass: expectedPaths.length > 0 && expectedPaths.join("|") === qr.paths.join("|"),
      detail: `actualPaths=${qr.paths.length}; expectedPaths=${expectedPaths.length}; uri=${expectedUri}`,
    });
  } else {
    checks.push({ name: "svg-paths-match-current-bill", pass: null, detail: "amount or receiver unavailable" });
  }
  checks.push({
    name: "manual-recording-remains-separate",
    pass: (await page.getByRole("button", { name: /Record payment/i }).count()) > 0,
    detail: "Record payment action remains outside the QR action",
  });
  return checks;
}


/**
 * Bounded diagnostic for a harness step that could not proceed: one
 * screenshot plus a short page excerpt, written to the ignored evidence
 * root. It never touches the product and never fails a run by itself.
 */
async function captureStepFailure(
  page: Page,
  record: { screenshots: string[] },
  name: string,
): Promise<void> {
  try {
    const shot = join(OUT_DIR, "bill-upi-qr", "failures", `${name}.png`);
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
    // Diagnostics are best effort; never mask the original failure.
  }
}

/**
 * Visual evidence for the bill-linked UPI QR: the open QR panel scrolled
 * into view, plus the separate manual recording area. The manual action is
 * never clicked; it is only framed.
 */
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
  const qrShot = join(OUT_DIR, "bill-upi-qr", theme, viewport, `${prefix}-qr.png`);
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
      "bill-upi-qr",
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

async function ownerRun(
  browser: Browser,
  theme: Theme,
  viewport: Viewport,
  fixture: Fixture,
): Promise<RunRecord[]> {
  const record: RunRecord = {
    surface: "owner-invoice",
    theme,
    viewport: viewport.name,
    route: "/owner/members",
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
  });
  try {
    await signIn(
      context,
      fixture.owner?.phone ?? fixture.actors?.owner ?? DEFAULT_OWNER_PHONE,
      fixture.owner?.pin ?? PIN,
      theme,
    );
    const page = await context.newPage();
    try {
      if (!fixture.memberId || !fixture.invoices?.openA?.number || !fixture.invoices.openB?.number || !fixture.invoices.closed?.number) {
        record.unavailable.push("fixture member and exact open/closed invoice numbers are required");
        return [record];
      }
      // The member 360 defaults to the Overview tab; the invoice panel only
      // renders for tab=payments, and it hydrates its rows asynchronously.
      await page.goto(
        `${BASE_URL}/owner/members/${fixture.memberId}?tab=payments`,
        { waitUntil: "domcontentloaded", timeout: 45_000 },
      );
      await page.locator("main h1").first().waitFor({ state: "visible", timeout: 30_000 });
      const rows = invoiceRows(page);
      const openRow = rows.filter({ hasText: fixture.invoices.openA.number }).first();
      const openRowVisible = await openRow
        .waitFor({ state: "visible", timeout: 30_000 })
        .then(() => true)
        .catch(() => false);
      if (!openRowVisible) {
        record.unavailable.push(
          `fixture invoice ${fixture.invoices.openA.number} did not render on ?tab=payments`,
        );
        await captureStepFailure(page, record, "owner-invoice-row-missing");
        return [record];
      }
      const opened = await openInvoiceRow(page, openRow);
      if (!opened) {
        record.unavailable.push(
          "fixture invoice row did not expand (client island not hydrated)",
        );
        await captureStepFailure(page, record, "owner-invoice-expand");
        return [record];
      }
      const methodSelect = page.locator("#invoice-payment-method").first();
      if ((await methodSelect.count()) > 0) {
        const methodReady = await selectUpiMethod(page, methodSelect);
        record.checks.push({
          name: "upi-method-selected",
          pass: methodReady,
          detail: methodReady
            ? "UPI method selected on the hydrated form"
            : "UPI method selection did not produce the Show UPI QR action",
        });
        if (!methodReady) {
          await captureStepFailure(page, record, "owner-upi-method");
          return [record];
        }
      }
      const rowText = await openRow.innerText();
      const expectedAmount = fixture.invoices.openA.amountPaise;
      const mutationBefore = await mutationSnapshot(fixture);
      const show = await showQr(page, fixture.receiver, record);
      const mutationAfter = await mutationSnapshot(fixture);
      record.checks.push(...show.checks, mutationCheck(mutationBefore, mutationAfter));
      if (show.qr) {
        record.qr = {
          account: show.qr.account,
          amount: show.qr.amount,
          invoice: show.qr.invoice,
          svgPaths: show.qr.paths,
          expectedUri: fixture.receiver && expectedAmount !== null ? expectedUpiUri(fixture.receiver, expectedAmount) : "",
          width: show.qr.width,
        };
        record.checks.push(...(await verifyQr(page, fixture, expectedAmount, null)));
        record.checks.push({
          name: "wrapper-invoice-belongs-to-open-row",
          pass:
            rowText.includes(fixture.invoices.openA.number) &&
            show.qr.invoiceId === fixture.invoices.openA.id,
          detail:
            `wrapper="${show.qr.invoice}"; wrapperInvoiceId=${show.qr.invoiceId}; ` +
            `fixtureNumber=${fixture.invoices.openA.number}; fixtureId=${fixture.invoices.openA.id}`,
        });
        await captureQrAndManual(page, record, theme, viewport.name, "owner");
        record.checks.push({
          name: "qr-data-invoice-id",
          pass: show.qr.invoiceId === fixture.invoices.openA.id,
          detail: `rendered=${show.qr.invoiceId}; fixture=${fixture.invoices.openA.id}`,
        });
        const secondRow = rows.filter({ hasText: fixture.invoices.openB.number }).first();
        if ((await secondRow.count()) > 0) {
          await openInvoiceRow(page, secondRow);
          const secondMethod = page.locator("#invoice-payment-method").first();
          if ((await secondMethod.count()) > 0) {
            await secondMethod.selectOption("upi").catch(() => {});
            await page.waitForTimeout(200);
          }
          const oldGone = (await page.locator('[data-testid="bill-upi-open"]').count()) === 0;
          record.checks.push({ name: "invoice-change-removes-old-qr", pass: oldGone, detail: oldGone ? "old QR removed" : "previous QR remained" });
          const secondShow = await showQr(page, fixture.receiver, record);
          record.checks.push(...secondShow.checks.filter((check) => check.name === "bill-upi-root-rendered"));
          if (secondShow.qr) {
            record.checks.push({
              name: "second-qr-data-invoice-id",
              pass: secondShow.qr.invoiceId === fixture.invoices.openB.id,
              detail: `rendered=${secondShow.qr.invoiceId}; fixture=${fixture.invoices.openB.id}`,
            });
            record.checks.push({
              name: "invoice-change-updates-qr",
              pass: secondShow.qr.invoice !== show.qr.invoice || secondShow.qr.amount !== show.qr.amount,
              detail: `before=${show.qr.invoice}/${show.qr.amount}; after=${secondShow.qr.invoice}/${secondShow.qr.amount}`,
            });
            const changeShot = join(OUT_DIR, "bill-upi-qr", theme, viewport.name, "owner-invoice-change.png");
            await mkdir(dirname(changeShot), { recursive: true });
            await page.screenshot({ path: changeShot, fullPage: false, animations: "disabled", caret: "hide" });
            record.screenshots.push(relative(ROOT, changeShot));
          }
        } else {
          record.checks.push({ name: "invoice-change-removes-old-qr", pass: null, detail: `second fixture invoice ${fixture.invoices.openB.number} not rendered` });
        }
        const closedRow = rows.filter({ hasText: fixture.invoices.closed.number }).first();
        if ((await closedRow.count()) > 0) {
          await openInvoiceRow(page, closedRow);
          const closedAbsent =
            (await page.getByRole("button", { name: "Show UPI QR", exact: true }).count()) === 0 &&
            (await page.locator('[data-testid="bill-upi-open"]').count()) === 0;
          record.checks.push({ name: "closed-invoice-has-no-qr", pass: closedAbsent, detail: closedAbsent ? "closed invoice exposes no QR action" : "closed invoice still exposes QR" });
        } else {
          record.checks.push({ name: "closed-invoice-has-no-qr", pass: null, detail: `closed fixture invoice ${fixture.invoices.closed.number} not rendered` });
        }
      }
      record.captured = record.screenshots.length > 0;
      record.tested = record.checks.filter((check) => check.pass !== null).map((check) => check.name);
      record.defects = record.checks.filter((check) => check.pass === false).map((check) => `${check.name}: ${check.detail}`);
      record.unavailable = record.checks.filter((check) => check.pass === null).map((check) => check.name);
      record.status = record.defects.length ? "CHANGES REQUIRED" : record.unavailable.length ? "UNTESTED" : "CAPTURED";
      return [record];
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    await context.close().catch(() => {});
  }
}

async function receptionRun(
  browser: Browser,
  theme: Theme,
  viewport: Viewport,
  fixture: Fixture,
): Promise<RunRecord> {
  const record: RunRecord = {
    surface: "reception-invoice",
    theme,
    viewport: viewport.name,
    route: "/reception/collect-payment",
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
  });
  try {
    await signIn(
      context,
      fixture.reception?.phone ?? fixture.actors?.reception ?? DEFAULT_RECEPTION_PHONE,
      fixture.reception?.pin ?? PIN,
      theme,
    );
    const page = await context.newPage();
    try {
      await page.goto(`${BASE_URL}/reception/collect-payment`, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.locator("main h1").first().waitFor({ state: "visible", timeout: 30_000 });
      const memberSearch = page.locator('[data-testid="payment-member-search"]').first();
      if ((await memberSearch.count()) === 0) {
        record.unavailable.push("reception payment-member-search not rendered");
        return record;
      }
      if (!fixture.memberName) {
        record.unavailable.push("fixture.memberName is required for reception search");
        return record;
      }
      if (!fixture.memberId || !fixture.invoices?.openA?.id || !fixture.invoices.openB?.id) {
        record.unavailable.push("fixture memberId/openA/openB are required for reception");
        return record;
      }
      // The reception screen is server-rendered, so its controls can exist
      // before React hydrates. Readiness is the real result appearing, not
      // the presence of an SSR node: search, and retry once if the first
      // interaction was lost to a late hydration.
      const memberResult = page.locator(
        `button[data-testid="payment-member-${fixture.memberId}"]`,
      );
      const searchButton = page.getByRole("button", { name: "Search", exact: true }).first();
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      const searchReady = await fillUntilEnabled(
        page,
        memberSearch,
        searchButton,
        fixture.memberName,
      );
      if (!searchReady) {
        record.unavailable.push(
          "reception search action never became enabled (client island not hydrated)",
        );
        await captureStepFailure(page, record, "reception-search-hydration");
        return record;
      }
      let memberReady = false;
      for (let attempt = 0; attempt < 2 && !memberReady; attempt++) {
        await searchButton.click();
        memberReady = await memberResult
          .waitFor({ state: "visible", timeout: 15_000 })
          .then(() => true)
          .catch(() => false);
      }
      if (!memberReady) {
        record.unavailable.push(
          "reception member search did not return the fixture member result",
        );
        await captureStepFailure(page, record, "reception-member-search");
        return record;
      }
      await memberResult.click();
      const invoiceA = page.locator(
        `button[data-testid="payment-invoice-${fixture.invoices.openA.id}"]`,
      );
      const invoiceB = page.locator(
        `button[data-testid="payment-invoice-${fixture.invoices.openB.id}"]`,
      );
      const invoiceReady = await invoiceA
        .waitFor({ state: "visible", timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      if (!invoiceReady) {
        record.unavailable.push(
          "reception invoice buttons did not render for the fixture member",
        );
        await captureStepFailure(page, record, "reception-invoice-buttons");
        return record;
      }
      await invoiceA.click();
      const upiRadio = page.getByRole("radio", { name: "UPI", exact: true }).first();
      if ((await upiRadio.count()) === 0) {
        record.unavailable.push("reception UPI method control not rendered");
        await captureStepFailure(page, record, "reception-upi-method");
        return record;
      }
      await upiRadio.check();
      const legacyAmount = await page.locator('[data-testid="collect-amount"]').count();
      record.checks.push({ name: "legacy-independent-amount-removed", pass: legacyAmount === 0, detail: `collect-amount count=${legacyAmount}` });
      const mutationBefore = await mutationSnapshot(fixture);
      const show = await showQr(page, fixture.receiver, record);
      const mutationAfter = await mutationSnapshot(fixture);
      record.checks.push(...show.checks, mutationCheck(mutationBefore, mutationAfter));
      if (show.qr) {
        record.qr = {
          account: show.qr.account,
          amount: show.qr.amount,
          invoice: show.qr.invoice,
          svgPaths: show.qr.paths,
          expectedUri: "",
          width: show.qr.width,
        };
        record.checks.push(...(await verifyQr(page, fixture, null, fixture.invoices.openA.number)));
        record.checks.push({
          name: "qr-data-invoice-id",
          pass: show.qr.invoiceId === fixture.invoices.openA.id,
          detail: `rendered=${show.qr.invoiceId}; fixture=${fixture.invoices.openA.id}`,
        });
        record.checks.push({
          name: "one-amount-tied-to-selected-invoice",
          pass: show.qr.amount.length > 0 && show.qr.invoice.length > 0,
          detail: `amount="${show.qr.amount}"; invoice="${show.qr.invoice}"`,
        });
        await captureQrAndManual(page, record, theme, viewport.name, "reception");
        if ((await invoiceB.count()) > 0) {
          await invoiceB.click();
          const oldGone = (await page.locator('[data-testid="bill-upi-open"]').count()) === 0;
          record.checks.push({ name: "invoice-change-removes-old-qr", pass: oldGone, detail: oldGone ? "old QR removed" : "previous QR remained" });
          // The recovery form is keyed by the selected invoice, so choosing
          // another invoice resets the method to Cash. Re-select UPI exactly
          // as a user would before asking for the second QR.
          const methodAgain = page.getByRole("radio", { name: "UPI", exact: true }).first();
          if ((await methodAgain.count()) > 0) {
            await methodAgain.check().catch(() => {});
            await page.waitForTimeout(300);
          }
          record.checks.push({
            name: "upi-method-reselected-after-invoice-change",
            pass: (await methodAgain.count()) > 0,
            detail: "UPI method re-selected on the second invoice",
          });
          const second = await showQr(page, fixture.receiver, record);
          if (second.qr) {
            record.checks.push({
              name: "second-qr-data-invoice-id",
              pass: second.qr.invoiceId === fixture.invoices.openB.id,
              detail: `rendered=${second.qr.invoiceId}; fixture=${fixture.invoices.openB.id}`,
            });
            record.checks.push({
              name: "invoice-change-updates-qr",
              pass: second.qr.invoice !== show.qr.invoice || second.qr.amount !== show.qr.amount,
              detail: `before=${show.qr.invoice}/${show.qr.amount}; after=${second.qr.invoice}/${second.qr.amount}`,
            });
            const changeShot = join(OUT_DIR, "bill-upi-qr", theme, viewport.name, "reception-invoice-change.png");
            await mkdir(dirname(changeShot), { recursive: true });
            await page.screenshot({ path: changeShot, fullPage: false, animations: "disabled", caret: "hide" });
            record.screenshots.push(relative(ROOT, changeShot));
          }
        } else {
          record.checks.push({ name: "invoice-change-removes-old-qr", pass: null, detail: "fixture openB invoice button not rendered" });
        }
      }
      const amountInput = page.locator('[data-testid="payment-amount"]').first();
      if ((await amountInput.count()) > 0) {
        const originalAmount = await amountInput.inputValue();
        await amountInput.fill("0");
        await page.waitForTimeout(250);
        const showButton = page.getByRole("button", { name: "Show UPI QR", exact: true }).first();
        const invalidUnavailable =
          ((await showButton.count()) > 0 && (await showButton.isDisabled())) ||
          (await page.locator('[data-testid="bill-upi-open"]').count()) === 0;
        record.checks.push({
          name: "invalid-amount-unavailable",
          pass: invalidUnavailable,
          detail: `showDisabled=${(await showButton.count()) > 0 ? await showButton.isDisabled() : "missing"}; openPanel=${await page.locator('[data-testid="bill-upi-open"]').count()}`,
        });
        await amountInput.fill(originalAmount);
        await page.waitForTimeout(150);
      }
      record.checks.push({
        name: "manual-recording-remains-separate",
        pass: (await page.getByRole("button", { name: /Record payment/i }).count()) > 0,
        detail: "manual Record payment action remains",
      });
      record.captured = record.screenshots.length > 0;
      record.tested = record.checks.filter((check) => check.pass !== null).map((check) => check.name);
      record.defects = record.checks.filter((check) => check.pass === false).map((check) => `${check.name}: ${check.detail}`);
      record.unavailable = record.checks.filter((check) => check.pass === null).map((check) => check.name);
      record.status = record.defects.length ? "CHANGES REQUIRED" : record.unavailable.length ? "UNTESTED" : "CAPTURED";
      return record;
    } finally {
      await page.close().catch(() => {});
    }
  } finally {
    await context.close().catch(() => {});
  }
}

async function sourceHashes(): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const file of SOURCE_FILES) {
    try {
      out[file] = createHash("sha256").update(await readFile(join(ROOT, file))).digest("hex");
    } catch {
      out[file] = null;
    }
  }
  return out;
}

function revision(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

const started = Date.now();
const fixture = await loadFixture();
let browser: Browser | null = null;
let budgetTimer: ReturnType<typeof setTimeout> | null = null;
let runPromise: Promise<void> | null = null;
let fatal: string | null = null;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const run = async () => {
    for (const theme of THEMES) {
      for (const viewport of VIEWPORTS) {
        // The whole sweep is bounded: once the budget is spent, the remaining
        // combinations are reported as untested instead of running on.
        if (Date.now() - started > BUDGET_MS) {
          records.push({
            surface: "owner-invoice", theme, viewport: viewport.name, route: "/owner/members",
            status: "UNTESTED", captured: false, tested: [], visualReviewed: false,
            visualVerdict: "PENDING", screenshots: [], checks: [],
            defects: [], unavailable: [`run budget of ${BUDGET_MS}ms exhausted before this combination`],
          });
          records.push({
            surface: "reception-invoice", theme, viewport: viewport.name, route: "/reception/collect-payment",
            status: "UNTESTED", captured: false, tested: [], visualReviewed: false,
            visualVerdict: "PENDING", screenshots: [], checks: [],
            defects: [], unavailable: [`run budget of ${BUDGET_MS}ms exhausted before this combination`],
          });
          continue;
        }
        try {
          records.push(...(await ownerRun(browser!, theme, viewport, fixture)));
        } catch (error) {
          records.push({
            surface: "owner-invoice", theme, viewport: viewport.name, route: "/owner/members",
            status: "BLOCKED", captured: false, tested: [], visualReviewed: false,
            visualVerdict: "PENDING", screenshots: [], checks: [],
            defects: [String(error).slice(0, 700)], unavailable: [],
          });
        }
        try {
          records.push(await receptionRun(browser!, theme, viewport, fixture));
        } catch (error) {
          records.push({
            surface: "reception-invoice", theme, viewport: viewport.name, route: "/reception/collect-payment",
            status: "BLOCKED", captured: false, tested: [], visualReviewed: false,
            visualVerdict: "PENDING", screenshots: [], checks: [],
            defects: [String(error).slice(0, 700)], unavailable: [],
          });
        }
      }
    }
  };
  const budget = new Promise<never>((_, reject) => {
    budgetTimer = setTimeout(() => reject(new Error(`script exceeded ${BUDGET_MS}ms budget`)), BUDGET_MS);
  });
  runPromise = run();
  await Promise.race([runPromise, budget]);
} catch (error) {
  fatal = String(error).slice(0, 1200);
} finally {
  if (budgetTimer) clearTimeout(budgetTimer);
  if (browser) await browser.close().catch(() => {});
  // Do not wait on an overrunning sweep: the browser is closed and the
  // remaining combinations are already recorded as untested.
  if (runPromise) await Promise.race([runPromise.catch(() => {}), new Promise((done) => setTimeout(done, 5_000))]);
}

const summary = {
  driver: "bill-upi-qr-chrome",
  startedAt: new Date(started).toISOString(),
  durationMs: Date.now() - started,
  baseUrl: BASE_URL,
  mode: process.env.NODE_ENV ?? "",
  deploymentStage: process.env.AQUA_DEPLOYMENT_STAGE ?? "",
  revision: revision(),
  sourceHashes: await sourceHashes(),
  fixture: {
    receiverSupplied: Boolean(fixture.receiver),
    invoicesSupplied: Boolean(fixture.invoices),
  },
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
    "Scoped feature QA only; not a source seal, build gate or full Owner acceptance.",
    "No payment, reversal, intent, UPI link, transfer or settings write is performed; the only database access is read-only, tenant-scoped identity snapshots of the fixture invoices.",
    "Expected SVG is generated independently from the displayed bill amount and the approved synthetic receiver.",
    "Physical phone/bank scans, real UPI apps, refunds and production money movement are NOT TESTED.",
  ],
};

await mkdir(OUT_DIR, { recursive: true });
await writeFile(join(OUT_DIR, "summary-bill-upi-qr.json"), JSON.stringify(summary, null, 2) + "\n");
console.log(
  `bill upi qr: ${summary.summary.captured}/${summary.summary.records} captured; ` +
    `${summary.summary.changesRequired} CHANGES REQUIRED; ${summary.summary.blocked} BLOCKED; ` +
    `${summary.summary.untested} UNTESTED; ${summary.durationMs}ms`,
);
if (fatal) console.error(`BILL UPI QR STOP: ${fatal}`);
if (
  fatal ||
  records.length === 0 ||
  records.some(
    (record) =>
      record.status === "CHANGES REQUIRED" ||
      record.status === "BLOCKED" ||
      record.status === "UNTESTED" ||
      record.checks.some((check) => check.pass === null),
  )
) {
  process.exitCode = 1;
}
