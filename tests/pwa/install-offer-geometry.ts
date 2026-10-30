// Historical expanded-card driver. Superseded for Chromium by
// tests/pwa/ribbon-20261030/direct-install-chrome.mjs (human revision 30 October).
// Install-ribbon geometry check at 390x844.
//
// The coordinator's browser review found that the old install offer
// covered member rows before it was dismissed. The offer is now a side
// ribbon (docs/design/pwa-side-ribbon-20261030/ribbon-contract.md), so
// this script measures THAT directly on a running server, so the finding
// cannot come back unnoticed:
//
//   1. the ribbon waits before it appears, so it never ambushes the
//      first thing the person came to do;
//   2. it ARRIVES COLLAPSED: one slim tab, and the move handle only
//      exists while the ribbon is open;
//   3. the collapsed tab is inside the page's own gutter, so it never
//      covers the Members row links;
//   4. it is docked to the RIGHT edge (root's placement correction of
//      30 October 2026: a left-edge ribbon would cover the desktop
//      sidebar navigation);
//   5. the expanded panel stays inside the viewport;
//   6. the ribbon never covers the bottom navigation;
//   7. a deliberate tap opens it, and it folds back into a tab;
//   8. the sign-in surface shows no ribbon at all.
//
// Run it against a server that already has the demo club seeded:
//
//   pnpm exec tsx tests/pwa/install-offer-geometry.ts http://127.0.0.1:3205
//
// It is NOT a *.test.ts file, so the Vitest suite does not pick it up:
// it needs a browser and a running server, which the unit suite does
// not have.
//
// Agent-owned file (tests/pwa/**).

import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://127.0.0.1:3205";
const DEMO_PHONE = process.env.AQUA_DEMO_PHONE ?? "919000000001";
// The demo PIN every seeded demo user shares (scripts/lib/demo-credentials.ts).
const DEMO_PIN = process.env.AQUA_DEMO_PIN ?? "123456";

const VIEWPORT = { width: 390, height: 844 };

type Measurement = {
  ribbonPresent: boolean;
  tabWidth: number;
  tabHeight: number;
  tabRight: number | null;
  contentRight: number | null;
  gutter: number | null;
  coversContent: boolean;
  handlePresent: boolean;
  ribbonRight: number | null;
  viewportWidth: number;
  dockedRight: boolean;
  panelVisible: boolean;
  panelTop: number | null;
  panelBottom: number | null;
  panelLeft: number | null;
  panelRight: number | null;
  panelInsideViewport: boolean;
  navTop: number | null;
  overlapsNavigation: boolean;
};

async function measure(page: import("playwright").Page): Promise<Measurement> {
  return await page.evaluate(() => {
    // tsx/esbuild wraps named functions in a __name() helper when it
    // compiles this file, and page.evaluate re-runs the callback's
    // source in the browser where that helper does not exist. Defining
    // it in the page scope keeps the measurement working.
    (globalThis as unknown as { __name?: (fn: unknown) => unknown }).__name ??= (fn: unknown) => fn;
    const ribbon = document.querySelector('[data-ribbon="install"]');
    const tab = ribbon?.querySelector('button[aria-label="Install options"]') ?? null;
    const handle = ribbon?.querySelector('button[aria-label="Move install ribbon"]') ?? null;
    const panel = ribbon?.querySelector('section[aria-label="Install Aqua"]') ?? null;
    const main = document.querySelector("main");
    const nav = Array.from(document.querySelectorAll("nav")).find(node =>
      (node.className || "").includes("fixed bottom-0"),
    );
    const ribbonBox = ribbon?.getBoundingClientRect() ?? null;
    const tabBox = tab?.getBoundingClientRect() ?? null;
    const contentRight = main ? Math.round(main.getBoundingClientRect().right) : null;
    const panelBox =
      panel && panel.getAttribute("hidden") === null ? panel.getBoundingClientRect() : null;
    const navBox = nav?.getBoundingClientRect() ?? null;
    const overlapsBox = (box: DOMRect | null) =>
      Boolean(
        ribbonBox &&
          box &&
          box.bottom > ribbonBox.top &&
          box.top < ribbonBox.bottom &&
          box.right > ribbonBox.left &&
          box.left < ribbonBox.right,
      );
    return {
      ribbonPresent: Boolean(ribbon),
      tabWidth: tabBox ? Math.round(tabBox.width) : 0,
      tabHeight: tabBox ? Math.round(tabBox.height) : 0,
      tabRight: tabBox ? Math.round(tabBox.right) : null,
      contentRight,
      gutter: contentRight === null ? null : window.innerWidth - contentRight,
      // Does the collapsed tab paint over the content it must not
      // cover? The content's right edge is the boundary.
      coversContent: Boolean(
        tabBox && contentRight !== null && tabBox.left < contentRight - 1,
      ),
      handlePresent: Boolean(handle),
      ribbonRight: ribbonBox ? Math.round(ribbonBox.right) : null,
      viewportWidth: window.innerWidth,
      dockedRight: Boolean(ribbonBox && Math.abs(ribbonBox.right - window.innerWidth) <= 1),
      panelVisible: panelBox !== null,
      panelTop: panelBox ? Math.round(panelBox.top) : null,
      panelBottom: panelBox ? Math.round(panelBox.bottom) : null,
      panelLeft: panelBox ? Math.round(panelBox.left) : null,
      panelRight: panelBox ? Math.round(panelBox.right) : null,
      panelInsideViewport: Boolean(
        panelBox &&
          panelBox.top >= 0 &&
          panelBox.bottom <= window.innerHeight &&
          panelBox.left >= 0 &&
          panelBox.right <= window.innerWidth,
      ),
      navTop: navBox ? Math.round(navBox.top) : null,
      overlapsNavigation: overlapsBox(navBox),
    };
  });
}

/** Chromium only fires beforeinstallprompt when it can really install;
 *  headless Chromium never does, so the event is simulated here. */
async function offerInstallEvent(page: import("playwright").Page) {
  await page.evaluate(() => {
    (globalThis as unknown as { __name?: (fn: unknown) => unknown }).__name ??= (fn: unknown) => fn;
    const event = new Event("beforeinstallprompt", { cancelable: true }) as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: string; platform: string }>;
    };
    event.prompt = async () => {};
    event.userChoice = Promise.resolve({ outcome: "accepted", platform: "web" });
    window.dispatchEvent(event);
  });
}

/** The event is simulated repeatedly: the component attaches its
 *  listener when the page hydrates, and a first page load after a code
 *  change can hydrate late. */
async function offerInstallEventRepeatedly(page: import("playwright").Page) {
  for (let attempt = 0; attempt < 5; attempt++) {
    await offerInstallEvent(page);
    await page.waitForTimeout(400);
  }
}

let failures = 0;
function check(label: string, ok: boolean, detail: string) {
  if (ok) {
    console.log(`[✓] ${label} — ${detail}`);
  } else {
    failures++;
    console.log(`[✗] ${label} — ${detail}`);
  }
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();

  // The sign-in surface: no ribbon, ever.
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  // The ribbon's listener lives in an effect: let the page hydrate before
  // the browser's install event is simulated, or the event is missed.
  await page.waitForTimeout(1200);
  await offerInstallEventRepeatedly(page);
  await page.waitForTimeout(6000);
  const signIn = await measure(page);
  check("sign-in surface shows no ribbon", !signIn.ribbonPresent, `ribbonPresent=${signIn.ribbonPresent}`);

  // Signed in: the members list, where the review found the overlap.
  await page.getByRole("textbox", { name: "Mobile number" }).fill(DEMO_PHONE);
  await page.getByRole("textbox", { name: "PIN" }).fill(DEMO_PIN);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/owner/, { timeout: 30_000 }).catch(() => {});
  await page.goto(`${BASE}/owner/members`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await offerInstallEventRepeatedly(page);
  // The ribbon arrives after its delay, not immediately.
  await page.waitForTimeout(1500);
  const early = await measure(page);
  check("the ribbon waits before it appears", !early.ribbonPresent, `ribbonPresent=${early.ribbonPresent}`);
  await page.waitForTimeout(4500);

  const shown = await measure(page);
  console.log(`    measured: ${JSON.stringify(shown)}`);
  // Visual evidence of the collapsed ribbon in place, next to the rows.
  await page.screenshot({ path: "/tmp/opencode/b4-install-ribbon-collapsed.png" });
  check("the ribbon appears", shown.ribbonPresent, `tab=${shown.tabWidth}x${shown.tabHeight}px`);
  check(
    "the ribbon is docked to the right edge",
    shown.dockedRight,
    `right=${shown.ribbonRight} viewport=${shown.viewportWidth}`,
  );
  check(
    "the ribbon arrives collapsed: one tab, no panel, no move handle",
    !shown.panelVisible && !shown.handlePresent,
    `panel=${shown.panelVisible} handle=${shown.handlePresent}`,
  );
  check(
    "the collapsed tab is a real hit target",
    shown.tabWidth >= 24 && shown.tabHeight >= 44,
    `${shown.tabWidth}x${shown.tabHeight}px`,
  );
  check(
    "the collapsed tab stays inside the page's gutter",
    !shown.coversContent,
    `gutter=${shown.gutter}px tabLeft=${shown.tabRight === null ? null : shown.tabRight - shown.tabWidth}`,
  );

  // A deliberate tap opens it.
  await page.getByRole("button", { name: "Install options" }).click();
  await page.waitForTimeout(400);
  const opened = await measure(page);
  console.log(`    measured: ${JSON.stringify(opened)}`);
  await page.screenshot({ path: "/tmp/opencode/b4-install-ribbon-open.png" });
  check("a deliberate tap opens the ribbon", opened.panelVisible, `panelVisible=${opened.panelVisible}`);
  check(
    "the move handle exists only while the ribbon is open",
    opened.handlePresent,
    `handle=${opened.handlePresent}`,
  );
  check(
    "the expanded panel stays inside the viewport",
    opened.panelInsideViewport,
    `panel=${opened.panelLeft}..${opened.panelRight} / ${opened.panelTop}..${opened.panelBottom}`,
  );
  check(
    "the ribbon never covers the bottom navigation",
    !opened.overlapsNavigation,
    `navTop=${opened.navTop}`,
  );

  // It folds back into a tab on its own.
  await page.waitForTimeout(11_000);
  const folded = await measure(page);
  check(
    "the ribbon folds into a tab",
    folded.ribbonPresent && !folded.panelVisible,
    `panelVisible=${folded.panelVisible}`,
  );
  check(
    "the folded tab is still a hit target",
    folded.tabWidth >= 24 && folded.tabHeight >= 44,
    `${folded.tabWidth}x${folded.tabHeight}px`,
  );

  await browser.close();
  console.log(failures === 0 ? "\nGeometry check passed." : `\n${failures} geometry check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
