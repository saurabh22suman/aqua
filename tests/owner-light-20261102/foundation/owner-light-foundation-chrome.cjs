#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports -- A standalone CommonJS script: it is run by node directly through owner_preview.py, outside the TypeScript build. */
"use strict";

// Foundation lane — the real Chrome check for the Owner light shell.
//
// WHAT THIS IS
//   A SMALL, standalone rendered check of the FOUNDATION surfaces only
//   (the owner shell header, the bottom navigation, the sidebar
//   wordmark, the shared page heading, the floating create action and
//   the content clearance) on the real application.
//
//   It is NOT a whole-app sweep and it is NOT a visual approval.
//
// HOW TO RUN (coordinator, through the shared harness only)
//   python3 .opencode/scripts/lane_job.py exec \
//     python3 .opencode/scripts/owner_preview.py \
//       --port <port> --out <evidence-dir> -- \
//       node tests/owner-light-20261102/foundation/owner-light-foundation-chrome.cjs
//
//   Environment it reads:
//     AQUA_E2E_BASE_URL  the preview origin (set by owner_preview.py)
//     AQUA_E2E_OUT       the evidence directory (set by owner_preview.py)
//     AQUA_E2E_EXPECT    "approved" (default) — the application MUST
//                        meet the approved mock's values; "baseline" —
//                        the characterisation of the UNCHANGED release
//                        (the known gap). The two are different claims:
//                        the baseline is characterisation, the approved
//                        expectation is the acceptance check.
//
//   It logs in with the SYNTHETIC LOCAL fixture only
//   (+919000000001 / 123456). It never touches a staging or a customer
//   database, and it starts no server of its own.

const fs = require("node:fs");
const path = require("node:path");

function loadPlaywright() {
  const candidates = [
    "playwright",
    path.join(process.cwd(), "node_modules", "playwright"),
  ];
  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch (error) {
      if (error && error.code !== "MODULE_NOT_FOUND") throw error;
    }
  }
  throw new Error("playwright is not resolvable from this checkout");
}

const BASE_URL = process.env.AQUA_E2E_BASE_URL;
const OUT_DIR = path.resolve(
  process.env.AQUA_E2E_OUT || "owner-light-foundation-chrome",
);
const EXPECT = process.env.AQUA_E2E_EXPECT || "approved";
const PHONE = "+919000000001";
const PIN = "123456";

// The values the APPROVED mock asks for
// (outputs/owner-mock-20261102/khelsuite-owner-light-type-mock.html).
const APPROVED = {
  headingFamilyContains: "Instrument Sans",
  headingWeight: 500,
  wordmarkFamilyContains: "Instrument Sans",
  wordmarkWeight: 500,
  mobileHeaderHeight: 52,
  navHeight: 64,
  navLabelFontSize: 12,
  navRestingWeight: 400,
  navActiveWeight: 500,
  navIconSize: 22,
  // Home carries no create action: the plain navigation clearance.
  clearanceWithoutAction: 64,
  // A page that carries the floating action reserves its footprint too.
  clearanceWithAction: 136,
};

// The characterisation of the UNCHANGED deployed release. These are the
// values the coordinator measured on 2 November 2026 (the header was
// 77px, because the club identity and the 48px facility control were
// stacked) — this mode describes the inherited product, it does not
// approve anything.
const CURRENT = {
  headingFamilyContains: "Bricolage",
  headingWeight: 600,
  wordmarkFamilyContains: "Bricolage",
  wordmarkWeight: 600,
  mobileHeaderHeight: 77,
  navHeight: 64,
  navLabelFontSize: 11,
  navRestingWeight: 500,
  navActiveWeight: 600,
  navIconSize: 20,
  clearanceWithoutAction: 64,
  clearanceWithAction: 64,
};

function near(actual, expected) {
  return Math.abs(Number(actual) - Number(expected)) <= 1;
}

async function measure(page) {
  return page.evaluate(() => {
    const header = document.querySelector('[data-testid="owner-top-bar"]');
    const shell = document.querySelector('[data-testid="owner-shell"]');
    const brand = document.querySelector('[data-testid="owner-shell-brand"]');

    // The VISIBLE primary navigation. The owner shell renders the
    // desktop sidebar's navigation too, and it is display:none on a
    // phone — selecting that one first would report a navigation that
    // is not on the screen at all. Only a navigation with a real box
    // counts.
    const navs = Array.from(
      document.querySelectorAll('nav[aria-label="Primary"]'),
    );
    const nav =
      navs.find((candidate) => candidate.getBoundingClientRect().height > 0) ??
      null;
    const navLinks = nav ? Array.from(nav.querySelectorAll(":scope > a")) : [];
    const active =
      navLinks.find((link) => link.getAttribute("aria-current") === "page") ||
      navLinks[0];
    const resting = navLinks.find((link) => link !== active) || navLinks[0];
    const heading = document.querySelector("h1");
    const wordmark = brand ? brand.querySelector("p") : null;
    const icon = resting ? resting.querySelector("svg") : null;
    const createAction = document.querySelector("[data-owner-create-action]");
    const figure = document.querySelector(".kpi");

    // ── the phone header row ──────────────────────────────────────
    // The facility control and the space its label actually has. The
    // label is measured with the control's OWN font (a canvas measure,
    // the same method the early mobile review used), and the available
    // width is the control's content box minus its own padding.
    const select = document.querySelector('[data-testid="facility-switcher"]');
    let facility = null;
    if (select instanceof HTMLSelectElement) {
      const computed = getComputedStyle(select);
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (context) {
        context.font = `${computed.fontStyle} ${computed.fontWeight} ${computed.fontSize} ${computed.fontFamily}`;
        const label = select.selectedOptions[0]?.textContent ?? "";
        const paddingLeft = Number.parseFloat(computed.paddingLeft) || 0;
        const paddingRight = Number.parseFloat(computed.paddingRight) || 0;
        facility = {
          label,
          textWidth: context.measureText(label).width,
          available:
            select.clientWidth - paddingLeft - paddingRight,
          controlWidth: select.getBoundingClientRect().width,
          controlHeight: select.getBoundingClientRect().height,
        };
      }
    }
    const searchInputs = Array.from(
      document.querySelectorAll('[data-testid="global-search-input"]'),
    );
    const moreDetails = Array.from(document.querySelectorAll("details")).find(
      (candidate) =>
        candidate.querySelector("summary")?.textContent?.trim() === "More",
    );

    const rect = (element) =>
      element ? element.getBoundingClientRect().height : null;

    return {
      url: window.location.href,
      heading: heading
        ? {
            text: (heading.textContent || "").trim().slice(0, 60),
            fontFamily: getComputedStyle(heading).fontFamily,
            fontWeight: getComputedStyle(heading).fontWeight,
            fontSize: getComputedStyle(heading).fontSize,
          }
        : null,
      // A big owner figure: the weight it is DRAWN with is the proof
      // that the owner tree uses the real 500 face and not a synthesised
      // 600.
      figure: figure
        ? {
            text: (figure.textContent || "").trim().slice(0, 40),
            fontFamily: getComputedStyle(figure).fontFamily,
            fontWeight: getComputedStyle(figure).fontWeight,
          }
        : null,
      wordmark: wordmark
        ? {
            text: (wordmark.textContent || "").trim(),
            fontFamily: getComputedStyle(wordmark).fontFamily,
            fontWeight: getComputedStyle(wordmark).fontWeight,
          }
        : null,
      headerHeight: rect(header),
      navHeight: rect(nav),
      navLinkCount: navLinks.length,
      navLabelFontSize: resting ? getComputedStyle(resting).fontSize : null,
      navRestingWeight: resting ? getComputedStyle(resting).fontWeight : null,
      navActiveWeight: active ? getComputedStyle(active).fontWeight : null,
      navIconSize: icon ? Number(icon.getAttribute("width")) : null,
      shellBottomClearance: shell
        ? Number.parseFloat(getComputedStyle(shell).paddingBottom)
        : null,
      hasCreateAction: Boolean(createAction),
      phone: {
        facility,
        headerHeight: header
          ? header.getBoundingClientRect().height
          : null,
        headerOverflow: header
          ? header.scrollWidth - header.clientWidth
          : null,
        // The record search must be reachable on a phone, and it must
        // not compete with the facility label inside the header row.
        searchInputCount: searchInputs.length,
        searchInMore: moreDetails
          ? searchInputs.some((input) => moreDetails.contains(input))
          : false,
        // The phone trigger is the summary labelled "Search records";
        // the DESKTOP search instance lives in the header too, but it
        // is hidden on a phone and must stay there.
        phoneSearchTriggerInHeader: header
          ? Array.from(header.querySelectorAll("summary")).some((summary) =>
              (summary.textContent ?? "").includes("Search records"),
            )
          : false,
      },
    };
  });
}

async function main() {
  if (!BASE_URL) {
    console.error("AQUA_E2E_BASE_URL is required");
    process.exit(2);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const problems = [];
  const report = {
    baseUrl: BASE_URL,
    expect: EXPECT,
    approved: APPROVED,
    baseline: CURRENT,
    measured: {},
    problems,
  };

  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => {
      problems.push({ kind: "pageerror", text: String(error) });
    });
    page.on("console", (message) => {
      // Every console error is reported: nothing is suppressed, so an
      // application error can never hide behind a filter.
      if (message.type() !== "error") return;
      problems.push({ kind: "console", text: message.text() });
    });

    // ── sign in with the synthetic local fixture ─────────────────────
    // The form is a hydrated client component: wait until it is
    // interactive before typing, so the driver never races the
    // hydration.
    await page.goto(`${BASE_URL}/login`, { waitUntil: "domcontentloaded" });
    const signIn = page.getByRole("button", { name: "Sign in", exact: true });
    await signIn.waitFor({ state: "visible", timeout: 30000 });
    await page.waitForFunction(() => {
      const button = Array.from(document.querySelectorAll("button")).find(
        (candidate) => candidate.textContent?.trim() === "Sign in",
      );
      return Boolean(button && !button.disabled);
    });
    await page.getByLabel("Mobile number", { exact: true }).fill(PHONE);
    // exact: the PIN field and the "Show PIN" button share the phrase.
    await page.getByLabel("PIN", { exact: true }).fill(PIN);
    await signIn.click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), {
      timeout: 45000,
    });
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.waitForSelector('[data-testid="owner-shell"]', {
      timeout: 30000,
    });

    // ── the phone home: the chrome and the plain clearance ────────────
    report.measured.home = await measure(page);
    await page.screenshot({
      path: path.join(OUT_DIR, "owner-mobile-390.png"),
      fullPage: false,
      caret: "initial",
    });

    // ── the same row at 320px: the narrowest phone ────────────────────
    await page.setViewportSize({ width: 320, height: 844 });
    await page.waitForTimeout(400);
    report.measured.narrow = await measure(page);
    await page.screenshot({
      path: path.join(OUT_DIR, "owner-mobile-320.png"),
      fullPage: false,
      caret: "initial",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(300);

    // ── the members directory: the floating create action ─────────────
    await page.goto(`${BASE_URL}/owner/members`, {
      waitUntil: "domcontentloaded",
    });
    await page
      .waitForSelector('[data-testid="owner-shell"]', { timeout: 30000 })
      .catch(() => undefined);
    await page.waitForTimeout(600);
    report.measured.members = await measure(page);
    await page.screenshot({
      path: path.join(OUT_DIR, "owner-members-390.png"),
      fullPage: false,
      caret: "initial",
    });

    // ── the desktop chrome ────────────────────────────────────────────
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${BASE_URL}/owner`, { waitUntil: "domcontentloaded" });
    await page
      .waitForSelector('[data-testid="owner-shell"]', { timeout: 30000 })
      .catch(() => undefined);
    await page.waitForTimeout(600);
    report.measured.desktop = await measure(page);
    await page.screenshot({
      path: path.join(OUT_DIR, "owner-desktop-1280.png"),
      fullPage: false,
      caret: "initial",
    });
    await context.close();
  } catch (error) {
    problems.push({ kind: "setup", text: String(error) });
  } finally {
    await browser.close().catch(() => undefined);
  }

  const checks = [];
  const add = (name, ok, detail) => {
    checks.push({ name, ok, detail });
    if (!ok) problems.push({ kind: "assertion", text: `${name}: ${detail}` });
  };
  const target = EXPECT === "baseline" ? CURRENT : APPROVED;

  const home = report.measured.home;
  if (home) {
    add(
      "heading family",
      home.heading && home.heading.fontFamily.includes(target.headingFamilyContains),
      `${home.heading ? home.heading.fontFamily : "missing"} (want ${target.headingFamilyContains})`,
    );
    add(
      "heading weight",
      home.heading && Number(home.heading.fontWeight) === target.headingWeight,
      `${home.heading ? home.heading.fontWeight : "missing"} (want ${target.headingWeight})`,
    );
    add(
      "mobile header height",
      near(home.headerHeight, target.mobileHeaderHeight),
      `${home.headerHeight} (want ${target.mobileHeaderHeight})`,
    );
    add(
      "bottom navigation height",
      near(home.navHeight, target.navHeight),
      `${home.navHeight} (want ${target.navHeight})`,
    );
    add(
      "navigation label size",
      near(Number.parseFloat(home.navLabelFontSize), target.navLabelFontSize),
      `${home.navLabelFontSize} (want ${target.navLabelFontSize})`,
    );
    add(
      "resting label weight",
      Number(home.navRestingWeight) === target.navRestingWeight,
      `${home.navRestingWeight} (want ${target.navRestingWeight})`,
    );
    add(
      "active label weight",
      Number(home.navActiveWeight) === target.navActiveWeight,
      `${home.navActiveWeight} (want ${target.navActiveWeight})`,
    );
    add(
      "navigation icon size",
      Number(home.navIconSize) === target.navIconSize,
      `${home.navIconSize} (want ${target.navIconSize})`,
    );
    add(
      "four phone destinations",
      home.navLinkCount === 3,
      `${home.navLinkCount} primary links plus the More disclosure (want 3)`,
    );
    add(
      "home keeps the plain clearance (no create action here)",
      near(home.shellBottomClearance, target.clearanceWithoutAction),
      `${home.shellBottomClearance} (want ${target.clearanceWithoutAction})`,
    );
  }

  // ── the phone header row at both widths ────────────────────────────
  for (const [label, measured] of [
    ["390", report.measured.home],
    ["320", report.measured.narrow],
  ]) {
    if (!measured || !measured.phone) continue;
    const phone = measured.phone;
    if (phone.facility) {
      add(
        `the facility label is not hard-clipped at ${label}`,
        phone.facility.textWidth <= phone.facility.available + 1,
        `"${phone.facility.label}" needs ${phone.facility.textWidth.toFixed(2)}px, ${phone.facility.available.toFixed(2)}px available in a ${phone.facility.controlWidth.toFixed(2)}px control`,
      );
      add(
        `the facility control keeps a 44px target at ${label}`,
        phone.facility.controlHeight >= 44,
        `${phone.facility.controlHeight}px tall`,
      );
    }
    add(
      `the header row does not overflow at ${label}`,
      (phone.headerOverflow ?? 0) <= 1,
      `${phone.headerOverflow}px of horizontal overflow`,
    );
    add(
      `the phone search trigger is not in the header row at ${label}`,
      !phone.phoneSearchTriggerInHeader,
      `a search trigger in the header: ${phone.phoneSearchTriggerInHeader}`,
    );
    add(
      `the record search is reachable from More at ${label}`,
      phone.searchInMore,
      `search inputs: ${phone.searchInputCount}, inside More: ${phone.searchInMore}`,
    );
  }

  const figure = home && home.figure;
  if (figure) {    add(
      "owner figure weight (a real face, never a synthesised 600)",
      Number(figure.fontWeight) === target.headingWeight,
      `${figure.fontWeight} (want ${target.headingWeight}) — "${figure.text}"`,
    );
    add(
      "owner figure family",
      figure.fontFamily.includes(target.headingFamilyContains),
      `${figure.fontFamily} (want ${target.headingFamilyContains})`,
    );
  }

  const members = report.measured.members;
  if (members) {
    const wanted = members.hasCreateAction
      ? target.clearanceWithAction
      : target.clearanceWithoutAction;
    add(
      "members clearance matches the create action it carries",
      near(members.shellBottomClearance, wanted),
      `${members.shellBottomClearance} (create action present: ${members.hasCreateAction}, want ${wanted})`,
    );
  }

  const desktop = report.measured.desktop;
  if (desktop) {
    add(
      "wordmark family",
      desktop.wordmark &&
        desktop.wordmark.fontFamily.includes(target.wordmarkFamilyContains),
      `${desktop.wordmark ? desktop.wordmark.fontFamily : "missing"} (want ${target.wordmarkFamilyContains})`,
    );
    add(
      "wordmark weight",
      desktop.wordmark &&
        Number(desktop.wordmark.fontWeight) === target.wordmarkWeight,
      `${desktop.wordmark ? desktop.wordmark.fontWeight : "missing"} (want ${target.wordmarkWeight})`,
    );
  }

  report.checks = checks;
  report.problems = problems;
  fs.writeFileSync(
    path.join(OUT_DIR, "owner-light-foundation-chrome.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  console.log(`OWNER LIGHT FOUNDATION — CHROME (expect: ${EXPECT})`);
  console.log(JSON.stringify({ measured: report.measured }, null, 2));
  for (const check of checks) {
    console.log(`${check.ok ? "PASS" : "FAIL"} ${check.name} — ${check.detail}`);
  }
  if (problems.length > 0) {
    console.log("PROBLEMS:");
    for (const problem of problems) {
      console.log(`- ${problem.kind}: ${problem.text}`);
    }
  }
  console.log(
    `report: ${path.join(OUT_DIR, "owner-light-foundation-chrome.json")}`,
  );
  process.exit(problems.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
