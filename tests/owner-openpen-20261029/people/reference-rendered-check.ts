import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

// Coordinator-provided bounded preview; run through owner_preview.py.
// This is the actual rendered regression for the People lane: surface
// composition, identity-first reading order, period copy and phone reflow.

const base = process.env.AQUA_E2E_BASE_URL;
const out = process.env.AQUA_E2E_OUT;
if (!base || !out) throw new Error("AQUA_E2E_BASE_URL/AQUA_E2E_OUT missing");
mkdirSync(out, { recursive: true });

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

type Report = {
  checks: Array<{ name: string; pass: boolean; detail?: unknown }>;
  failures: string[];
};

const report: Report = { checks: [], failures: [] };
function check(name: string, condition: boolean, detail?: unknown) {
  report.checks.push({ name, pass: condition, detail });
  if (!condition) report.failures.push(name);
}

const browser = await chromium.launch();
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${base}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Mobile number").fill("9000000001");
  await page.getByLabel(/^PIN/i).fill("123456");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/owner/, { timeout: 60_000 });

  async function open(path: string, width = 1280, height = 900) {
    await page.setViewportSize({ width, height });
    await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
    await page.waitForTimeout(250);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    check(`${path} ${width}px no horizontal page overflow`, overflow <= 0, overflow);
    return overflow;
  }

  await open("/owner/members");
  const members = await page.evaluate(() => {
    const head = document.querySelector('[data-testid="members-table-head"]');
    const rows = Array.from(document.querySelectorAll('[data-testid="member-row"]'));
    return {
      heading: Array.from(document.querySelectorAll("h2")).some(
        (h) => h.textContent?.trim() === "Member directory",
      ),
      head: head?.textContent ?? "",
      rows: rows.length,
      firstHref: rows[0]?.getAttribute("href") ?? null,
      firstText: rows[0]?.textContent ?? "",
    };
  });
  check("members directory heading", members.heading);
  check("members head puts identity before member-since", members.head.indexOf("Member") <= members.head.indexOf("Member since"), members.head);
  check("members rows render", members.rows > 0, members.rows);
  check("members row exposes one Open action", members.firstText.includes("Open"));
  await open("/owner/members", 390, 844);
  const mobileMember = await page.evaluate(() => {
    const row = document.querySelector('[data-testid="member-row"]');
    return { text: (row?.textContent ?? "").toLowerCase(), tag: row?.tagName ?? "" };
  });
  check("members phone labels phone", mobileMember.text.includes("phone"));
  check("members phone labels member since", mobileMember.text.includes("member since"));
  check("members row remains one whole-row link", mobileMember.tag === "A");

  await open("/owner/fees?tab=dues");
  const dues = await page.evaluate(() => {
    const surface = document.querySelector('[data-testid="invoice-ledger-surface"]');
    const head = document.querySelector('[data-testid="invoice-ledger-head"]');
    const rows = Array.from(document.querySelectorAll('[data-testid="invoice-ledger-row"]'));
    if (!surface || !head || !rows[0]) return { oneSurface: false, aligned: false, period: false, head: "", deltas: [], rowTexts: [] };
    const headCells = Array.from(head.querySelectorAll('th')).map((el) => el.getBoundingClientRect().left);
    const rowCells = Array.from(rows[0].children)
      .slice(0, 5)
      .map((el) => el.getBoundingClientRect().left);
    const rowTexts = rows.slice(0, 3).map((row) => row.textContent ?? "");
    return {
      oneSurface: surface.contains(head) && rows.every((row) => surface.contains(row)),
      rows: rows.length,
      head: head.textContent ?? "",
      deltas: [1, 2, 3, 4].map((i) => Math.abs(headCells[i]! - rowCells[i]!)),
      rowTexts,
      aligned: [1, 2, 3, 4].every((i) => Math.abs(headCells[i]! - rowCells[i]!) <= 1),
      period: document.body.textContent?.includes("Period 1 Oct 2026") ?? false,
      divider: getComputedStyle(rows[0].querySelector('td')!).borderBottomWidth,
    };
  });
  check("dues one bounded ledger surface", dues.oneSurface);
  check("dues header/rows share column tracks", dues.aligned, dues.deltas);
  const duesTable = page.getByRole("table", { name: "Outstanding invoices" });
  check("dues exposes a named table", (await duesTable.count()) === 1);
  const headers = await page.getByRole("columnheader").allTextContents();
  check(
    "dues exposes six scoped column headers",
    headers.length === 6 && headers[0].includes("Member / invoice") && headers[5].includes("Action"),
    headers,
  );
  const visibleOpen = await page.getByRole("button", { name: "Open", exact: true }).count();
  check("dues exposes one visible Open action per row", visibleOpen === dues.rows, { visibleOpen, rows: dues.rows });
  check(
    "dues alignment uses varied names and amounts",
    new Set(dues.rowTexts).size > 1,
    dues.rowTexts.map((text) => text.slice(0, 50)),
  );
  check("dues current-state copy has no reporting period", !dues.period);
  check("dues rows are divided", dues.divider === "1px", dues.divider);
  await open("/owner/fees?tab=dues", 390, 844);

  await open("/owner/fees?tab=invoices");
  const invoicesPeriod = await page.evaluate(
    () => document.body.textContent?.includes("Asia/Kolkata") ?? false,
  );
  check("invoices current-state copy has no period/timezone", !invoicesPeriod);

  await open("/owner/fees?tab=transactions");
  const transactions = await page.evaluate(() => {
    const surface = document.querySelector('[data-testid="fees-transaction-surface"]');
    const head = document.querySelector('[data-testid="fees-transaction-head"]');
    const rows = Array.from(document.querySelectorAll('[data-testid="fees-transaction-row"]'));
    return {
      oneSurface: !!surface && !!head && rows.every((row) => surface.contains(row)),
      head: head?.textContent ?? "",
      rows: rows.length,
    };
  });
  check("transactions one ledger surface", transactions.oneSurface);
  check(
    "transactions identity precedes recorded time",
    transactions.head.indexOf("Member") < transactions.head.indexOf("Recorded"),
    transactions.head,
  );
  await open("/owner/fees?tab=transactions", 390, 844);

  await open("/owner/fees");
  const overview = await page.evaluate(() => document.body.textContent ?? "");
  check("overview keeps its period basis", overview.includes("Period") && overview.includes("Asia/Kolkata"));

  const detailHref = members.firstHref;
  assert(detailHref, "no member detail link found");
  await open(detailHref);
  const detail = await page.evaluate(() => {
    const body = document.body.textContent ?? "";
    const tools = Array.from(document.querySelectorAll("h2")).find(
      (h) => h.textContent?.trim() === "Other member tools",
    );
    const card = document.querySelector('[data-testid="member-id-card"]');
    const order = tools && card
      ? !!(tools.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING)
      : false;
    return { body, order };
  });
  check("member detail keeps participation and contacts", detail.body.includes("Participation & enrolment") && detail.body.includes("Contacts & consent"));
  check("member detail ID card sits under other tools", detail.order);
  await open(detailHref, 390, 844);
  await open(`${detailHref}?tab=payments`);
  await page.waitForSelector('[data-testid="member-invoice-due"]', { timeout: 10_000 });
  const payments = await page.evaluate(() => document.body.textContent ?? "");
  check("member payments shows due evidence", payments.includes("Due "), payments.slice(0, 80));
  check("member payments shows balance evidence", payments.includes("Balance "));

  await open("/owner/members/new");
  const create = await page.evaluate(() => document.body.textContent ?? "");
  check("create editor names its sections", create.includes("Personal details") && create.includes("Consent"));
  check("create editor offers Cancel", create.includes("Cancel"));
  await open("/owner/members/import");
  const importPage = await page.evaluate(() => document.body.textContent ?? "");
  check("import names reviewed flow", importPage.includes("Import members") && importPage.includes("CSV template"));

  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (report.failures.length > 0) process.exit(1);
} catch (error) {
  report.failures.push(String(error));
  writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
} finally {
  await browser.close();
}
