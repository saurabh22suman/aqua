#!/usr/bin/env tsx
/**
 * Multi-branch (facility scope) reviewer — durable owner artifact.
 *
 * The journey is the one the 30 October 2026 run recorded, unchanged:
 *
 *   * "All facilities" shows every branch's records;
 *   * choosing branch B shows branch B and nothing of branch A;
 *   * Back restores the URL, the control and the list;
 *   * an explicit branch choice follows the owner to Home, Fees,
 *     Programs and Reports;
 *   * an explicit URL beats the remembered choice;
 *   * a reload keeps the explicit URL;
 *   * "All facilities" clears both the query and the cookie;
 *   * the booking desk offers the venues of BOTH branches.
 *
 * Two corrections over the throwaway driver this replaces:
 *
 *   1. The member evidence is DERIVED, and it is derived from the
 *      BRANCH it belongs to. The old driver asserted a hardcoded
 *      member name — a misspelling of the first member of the first
 *      branch — so every branch assertion was wrong before it was run.
 *      This reviewer chooses branch A, reads the first member row's
 *      own name out of the rendered list, and then uses that name for
 *      the branch-B emptiness check: the member that must disappear
 *      under branch B is a member branch B does not have.
 *   2. The option is chosen from the OPEN NAMED LISTBOX. The shared
 *      Select is the real native `<select>` PLUS the custom popup, so
 *      a page-level `getByRole("option")` matches the native options
 *      and the popup's options at once. This reviewer scopes the
 *      choice to the popup — the control's own listbox, named after
 *      the control ("Facility options").
 *
 * The branch labels are derived from the control's own options too, so
 * no branch is named in code.
 *
 * The synthetic fixture is passed in explicitly — a file path in
 * AQUA_MULTISITE_FIXTURE (or argv[2]) — and holds ids only. The
 * reviewer refuses a fixture that does not name a disposable
 * `aqua_test_*` database, and it never reads credentials: the sign-in
 * comes from the reviewer's own environment.
 *
 * Run it against a bounded preview:
 *
 *   AQUA_E2E_BASE_URL=http://127.0.0.1:<port> \
 *   AQUA_E2E_OUT=.playwright-mcp/multisite-reviewer \
 *   AQUA_MULTISITE_FIXTURE=<fixture.json> \
 *   pnpm exec tsx tests/owner-openpen-20261029/reviewer/multisite-chrome.ts
 *
 * Exit code 0 means every check passed.
 */
import { chromium, type BrowserContext, type Page } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

type MultisiteFixture = {
  namespace?: string;
  database?: string;
  tenantId: string;
  branchA: string;
  branchB: string;
  venueA2: string;
  venueB: string;
};

type Check = { name: string; pass: boolean; detail: string };

const BASE_URL = process.env.AQUA_E2E_BASE_URL ?? "";
const OUT = process.env.AQUA_E2E_OUT ?? ".playwright-mcp/multisite-reviewer";
const PHONE = process.env.AQUA_E2E_PHONE ?? "+919000000001";
const PIN = process.env.AQUA_E2E_PIN ?? "123456";
const FIXTURE_PATH =
  process.env.AQUA_MULTISITE_FIXTURE ?? process.argv[2] ?? "";
const THEMES = (process.env.AQUA_E2E_THEMES ?? "mint,lavender")
  .split(",")
  .map((theme) => theme.trim())
  .filter(Boolean);
const VIEWPORTS = [
  { name: "phone-390x844", width: 390, height: 844 },
  { name: "desktop-1280x900", width: 1280, height: 900 },
];

const ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readFixture(): MultisiteFixture {
  if (!FIXTURE_PATH) {
    throw new Error(
      "AQUA_MULTISITE_FIXTURE (or argv[2]) must point at the synthetic fixture file.",
    );
  }
  const fixture = JSON.parse(
    readFileSync(resolve(FIXTURE_PATH), "utf8"),
  ) as MultisiteFixture;
  for (const key of [
    "tenantId",
    "branchA",
    "branchB",
    "venueA2",
    "venueB",
  ] as const) {
    const value = fixture[key];
    if (typeof value !== "string" || !ID.test(value)) {
      throw new Error(`The fixture's ${key} is not an id: ${String(value)}`);
    }
  }
  if (fixture.database && !fixture.database.startsWith("aqua_test_")) {
    throw new Error(
      `Refusing a fixture that names ${fixture.database}: the multisite fixture belongs in a disposable aqua_test_* database.`,
    );
  }
  return fixture;
}

/** The control's own option label for a value — no branch is named in code. */
async function optionLabel(page: Page, value: string): Promise<string> {
  const label = await page
    .locator("#facility-switcher option")
    .evaluateAll(
      (options, id) =>
        options.find((option) => (option as HTMLOptionElement).value === id)
          ?.textContent?.trim() ?? "",
      value,
    );
  return label;
}

/**
 * The first member name the rendered list actually shows.
 *
 * Read AFTER branch A is selected, so the evidence belongs to the
 * branch it is used to argue about.
 */
async function firstMemberName(page: Page): Promise<string> {
  const name = await page
    .locator('[data-testid="member-row-name"]')
    .first()
    .textContent();
  return (name ?? "").trim();
}

/**
 * Choose a branch through the shared control's OWN popup.
 *
 * The control is the native select; the popup is the listbox the
 * control opens, named after the control. The choice is made inside
 * that listbox, so the native `<option>`s can never be matched by
 * mistake.
 */
async function chooseBranch(
  page: Page,
  value: string,
  label: string,
): Promise<void> {
  await page.getByRole("combobox", { name: "Facility", exact: true }).click();
  const listbox = page.getByRole("listbox", { name: "Facility options" });
  await listbox.getByRole("option", { name: label, exact: true }).click();
  await page.waitForURL(
    (url) => (url.searchParams.get("facility") ?? "all") === value,
    { timeout: 30_000 },
  );
  await page.waitForLoadState("networkidle");
}

async function runScenario(
  context: BrowserContext,
  page: Page,
  fixture: MultisiteFixture,
  theme: string,
  viewport: { name: string; width: number; height: number },
): Promise<Check[]> {
  const checks: Check[] = [];
  const check = (name: string, pass: boolean, detail: string) => {
    checks.push({ name, pass, detail });
  };

  const open = async (path: string) => {
    await page.goto(`${BASE_URL}${path}`, {
      waitUntil: "networkidle",
      timeout: 60_000,
    });
    await page.locator("main").waitFor();
  };
  const chosen = () => page.locator("#facility-switcher").inputValue();
  const memberVisible = async (name: string) =>
    (await page.locator("main").getByText(name, { exact: false }).count()) > 0;

  await open("/owner/members");

  const branchBLabel = await optionLabel(page, fixture.branchB);
  const branchALabel = await optionLabel(page, fixture.branchA);
  const allLabel = await optionLabel(page, "all");

  check(
    "initial-all-branches",
    (await chosen()) === "all",
    `switcher="${await chosen()}"`,
  );

  // The member evidence comes from the page, never from a literal —
  // and it is taken under the branch it belongs to.
  await chooseBranch(page, fixture.branchA, branchALabel);
  const member = await firstMemberName(page);
  check(
    "member-evidence-derived-from-the-list",
    member.length > 0,
    `the first member row of branch A is "${member}"`,
  );
  check(
    "initial-member-present",
    member.length > 0 && (await memberVisible(member)),
    `member="${member}" is present under branch A`,
  );

  await chooseBranch(page, fixture.branchB, branchBLabel);
  check(
    "branch-b-control-matches-url",
    (await chosen()) === fixture.branchB,
    `switcher="${await chosen()}"`,
  );
  check(
    "branch-b-empty-not-other-branch-records",
    !(await memberVisible(member)),
    `the branch A member "${member}" is absent under branch B`,
  );
  await page.screenshot({
    path: `${OUT}/${theme}-${viewport.width}-branch-b-empty.png`,
  });

  await chooseBranch(page, fixture.branchA, branchALabel);
  check(
    "branch-a-records-return",
    await memberVisible(member),
    `member="${member}" is present under branch A`,
  );

  await page.goBack({ waitUntil: "networkidle" });
  // Back restores the URL and the control at once, but the members
  // board's rows arrive with the server component that commits after
  // it: the control can already read branch B while the list still
  // shows branch A's member. The wait is therefore on BOTH — the
  // control's own value AND the derived branch A member's name gone
  // from the rendered member rows — so the check below reads a
  // committed list instead of a stale one.
  //
  // The wait is bounded and web-first (Playwright polls the page, there
  // is no fixed sleep and no waiver): a list that never clears fails
  // the journey after 5 seconds rather than passing.
  await page.waitForFunction(
    ({ id, member }) => {
      const control = document.querySelector(
        "#facility-switcher",
      ) as HTMLSelectElement | null;
      if (control?.value !== id) return false;
      const names = Array.from(
        document.querySelectorAll('[data-testid="member-row-name"]'),
      ).map((node) => (node.textContent ?? "").trim());
      return !names.includes(member);
    },
    { id: fixture.branchB, member },
    { timeout: 5_000 },
  );
  const backMemberPresent = await memberVisible(member);
  check(
    "back-syncs-control-and-records",
    (await chosen()) === fixture.branchB && !backMemberPresent,
    `switcher="${await chosen()}"; the branch A member "${member}" is ${
      backMemberPresent ? "still listed" : "absent"
    }`,
  );

  // Back changes the URL scope, not the remembered preference.
  //
  // The shared control does not fire a change when the option that is
  // already selected is picked again (use-select-popup's chooseOption
  // returns early when select.value === value). After Back the
  // control already shows branch B, so choosing B again would be a
  // no-op: the remembered preference would stay on branch A and every
  // later route would follow the WRONG cookie. The remembered choice
  // is therefore moved to another branch first and then to branch B —
  // two genuine changes, each with the same waits as every other
  // choice.
  await chooseBranch(page, fixture.branchA, branchALabel);
  await chooseBranch(page, fixture.branchB, branchBLabel);
  for (const route of [
    "/owner/fees",
    "/owner/programs",
    "/owner/reports",
    "/owner",
  ]) {
    await open(route);
    await page.waitForURL(
      (url) => url.searchParams.get("facility") === fixture.branchB,
    );
    check(
      `cookie-follows-branch:${route}`,
      (await chosen()) === fixture.branchB,
      `switcher="${await chosen()}"`,
    );
    check(
      `no-overflow:${route}`,
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth + 1,
      ),
      "no page-level horizontal overflow",
    );
  }

  await open(`/owner/members?facility=${fixture.branchA}`);
  check(
    "explicit-url-wins-over-cookie",
    (await chosen()) === fixture.branchA && (await memberVisible(member)),
    `switcher="${await chosen()}"`,
  );
  await page.reload({ waitUntil: "networkidle" });
  check(
    "reload-preserves-explicit-url",
    (await chosen()) === fixture.branchA,
    `switcher="${await chosen()}"`,
  );

  await chooseBranch(page, "all", allLabel);
  check(
    "all-clears-url-and-cookie",
    !new URL(page.url()).searchParams.has("facility") &&
      !(await context.cookies()).some(
        (cookie) => cookie.name === "aqua_facility",
      ),
    "no facility query and no facility cookie",
  );
  check(
    "all-restores-consolidated-records",
    await memberVisible(member),
    `member="${member}" is present again`,
  );

  await open("/owner/bookings");
  check(
    "bookings-does-not-show-unconnected-global-picker",
    (await page.locator("#facility-switcher").count()) === 0,
    "the booking desk has no global facility picker",
  );
  const venues = page.locator('[data-testid="booking-facility"]');
  check(
    "bookings-lists-venues-from-both-branches",
    (await venues.locator(`option[value="${fixture.venueA2}"]`).count()) === 1 &&
      (await venues.locator(`option[value="${fixture.venueB}"]`).count()) === 1,
    `venueA2=${fixture.venueA2}; venueB=${fixture.venueB}`,
  );
  await page.screenshot({
    path: `${OUT}/${theme}-${viewport.width}-booking-venues.png`,
  });

  return checks;
}

async function main(): Promise<number> {
  if (!BASE_URL) throw new Error("AQUA_E2E_BASE_URL must name the preview.");
  const fixture = readFixture();
  mkdirSync(OUT, { recursive: true });
  mkdirSync(dirname(`${OUT}/multisite.json`), { recursive: true });

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const records: Array<{
    theme: string;
    viewport: string;
    checks: Check[];
    status: string;
  }> = [];
  try {
    for (const theme of THEMES) {
      for (const viewport of VIEWPORTS) {
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          locale: "en-IN",
          timezoneId: "Asia/Kolkata",
          reducedMotion: "reduce",
        });
        const page = await context.newPage();
        page.setDefaultTimeout(15_000);
        let checks: Check[] = [];
        try {
          await page.goto(`${BASE_URL}/login`, {
            waitUntil: "networkidle",
            timeout: 60_000,
          });
          await page.locator("#login-phone").fill(PHONE);
          await page.locator("#login-pin").fill(PIN);
          await Promise.all([
            page.waitForURL((url) => !url.pathname.startsWith("/login"), {
              timeout: 60_000,
            }),
            page.locator("form button[type=submit]").click(),
          ]);
          await context.addCookies([
            { name: "aqua_theme", value: theme, url: BASE_URL },
          ]);
          checks = await runScenario(
            context,
            page,
            fixture,
            theme,
            viewport,
          );
        } catch (error) {
          checks = [
            {
              name: "scenario-completed",
              pass: false,
              detail: String(error).slice(0, 800),
            },
          ];
          await page
            .screenshot({
              path: `${OUT}/${theme}-${viewport.width}-failure.png`,
            })
            .catch(() => {});
        }
        records.push({
          theme,
          viewport: viewport.name,
          checks,
          status: checks.every((check) => check.pass)
            ? "PASS"
            : "CHANGES REQUIRED",
        });
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  const failures = records.flatMap((record) =>
    record.checks
      .filter((check) => !check.pass)
      .map((check) => ({
        theme: record.theme,
        viewport: record.viewport,
        ...check,
      })),
  );
  writeFileSync(
    `${OUT}/multisite.json`,
    `${JSON.stringify(
      {
        at: new Date().toISOString(),
        fixture,
        mode: "synthetic branches/venues, read-only UI after login",
        securityBoundaryProof:
          "Separate runtime tests; the picker itself is not an authorisation boundary",
        visualAcceptance: "PENDING",
        records,
      },
      null,
      2,
    )}\n`,
  );
  console.log(
    JSON.stringify({
      cases: records.length,
      checks: records.reduce(
        (total, record) => total + record.checks.length,
        0,
      ),
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
    console.error(`MULTISITE REVIEWER STOP: ${String(error).slice(0, 800)}`);
    process.exitCode = 1;
  });
