// Install-offer geometry check at 390x844.
//
// The coordinator's browser review found that the install offer covered
// member rows before it was dismissed. This script measures that
// directly on a running dev server, so the finding cannot come back
// unnoticed:
//
//   1. the offer must not overlap the bottom navigation;
//   2. the offer must not cover any interactive control on the page
//      (the row actions on a member list are on the right);
//   3. the offer must be compact (one row, not a card);
//   4. the offer must leave the page on its own;
//   5. the sign-in surface must show no offer at all.
//
// Run it against a dev server that already has the demo club seeded:
//
//   pnpm exec tsx tests/pwa/install-offer-geometry.ts http://127.0.0.1:3112
//
// It is NOT a *.test.ts file, so the Vitest suite does not pick it up:
// it needs a browser and a running server, which the unit suite does
// not have.
//
// Agent-owned file (tests/pwa/**).

import { chromium } from "playwright";

const BASE = process.argv[2] ?? "http://127.0.0.1:3112";
const DEMO_PHONE = process.env.AQUA_DEMO_PHONE ?? "919000000001";
// The demo PIN every seeded demo user shares (scripts/lib/demo-credentials.ts).
const DEMO_PIN = process.env.AQUA_DEMO_PIN ?? "123456";

const VIEWPORT = { width: 390, height: 844 };

type Measurement = {
  offerPresent: boolean;
  offerHeight: number;
  offerWidth: number;
  offerTop: number | null;
  offerBottom: number | null;
  navTop: number | null;
  overlapsNavigation: boolean;
  coveredControls: number;
  blocksContent: boolean;
  coveredRows: number;
  visibleRows: number;
};

async function measure(page: import("playwright").Page): Promise<Measurement> {
  return await page.evaluate(() => {
    // tsx/esbuild wraps named functions in a __name() helper when it
    // compiles this file, and page.evaluate re-runs the callback's
    // source in the browser where that helper does not exist. Defining
    // it in the page scope keeps the measurement working.
    (globalThis as unknown as { __name?: (fn: unknown) => unknown }).__name ??= (fn: unknown) => fn;
    const section = document.querySelector('section[aria-label="Install Aqua"]');
    // The visible surface is the pill inside the section; the section
    // only adds the gap that keeps it off the navigation.
    const offer = section?.querySelector(":scope > div") ?? null;
    const nav = Array.from(document.querySelectorAll("nav")).find(node =>
      (node.className || "").includes("fixed bottom-0"),
    );
    const offerBox = offer?.getBoundingClientRect() ?? null;
    const navBox = nav?.getBoundingClientRect() ?? null;
    const rows = Array.from(document.querySelectorAll("li, tr")).filter(
      row => row.getBoundingClientRect().height > 10,
    );
    const visible = rows.filter(row => {
      const box = row.getBoundingClientRect();
      return box.top < window.innerHeight && box.bottom > 0;
    });
    const controls = Array.from(
      document.querySelectorAll("button, a[href], input, select, textarea"),
    ).filter(node => {
      const box = node.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && box.top < window.innerHeight && box.bottom > 0;
    });
    const overlapsBox = (box: DOMRect | null) =>
      Boolean(
        offerBox &&
          box &&
          box.bottom > offerBox.top &&
          box.top < offerBox.bottom &&
          box.right > offerBox.left &&
          box.left < offerBox.right,
      );
    const overlaps = (node: Element) => overlapsBox(node.getBoundingClientRect());
    return {
      offerPresent: Boolean(offer),
      offerHeight: offerBox ? Math.round(offerBox.height) : 0,
      offerWidth: offerBox ? Math.round(offerBox.width) : 0,
      offerTop: offerBox ? Math.round(offerBox.top) : null,
      offerBottom: offerBox ? Math.round(offerBox.bottom) : null,
      navTop: navBox ? Math.round(navBox.top) : null,
      overlapsNavigation: Boolean(
        offerBox && navBox && offerBox.bottom > navBox.top && offerBox.top < navBox.bottom,
      ),
      coveredControls: controls.filter(overlaps).length,
      // What actually matters: does the offer BLOCK what is beneath it?
      // The offer is pointer-transparent, so the element under the
      // pointer is the page's own content, not the offer.
      blocksContent: (() => {
        if (!offer || !offerBox) return false;
        const hit = document.elementFromPoint(
          (offerBox.left + offerBox.right) / 2,
          (offerBox.top + offerBox.bottom) / 2,
        );
        return Boolean(hit && offer.contains(hit));
      })(),
      coveredRows: visible.filter(overlaps).length,
      visibleRows: visible.length,
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

  // The sign-in surface: no offer, ever.
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  // The offer's listener lives in an effect: let the page hydrate before
  // the browser's install event is simulated, or the event is missed.
  await page.waitForTimeout(1200);
  await offerInstallEventRepeatedly(page);
  await page.waitForTimeout(6000);
  const signIn = await measure(page);
  check("sign-in surface shows no offer", !signIn.offerPresent, `offerPresent=${signIn.offerPresent}`);

  // Signed in: the members list, where the review found the overlap.
  await page.getByRole("textbox", { name: "Mobile number" }).fill(DEMO_PHONE);
  await page.getByRole("textbox", { name: "PIN" }).fill(DEMO_PIN);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/owner/, { timeout: 30_000 }).catch(() => {});
  await page.goto(`${BASE}/owner/members`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await offerInstallEventRepeatedly(page);
  // The offer arrives after its delay, not immediately.
  await page.waitForTimeout(1500);
  const early = await measure(page);
  check("the offer waits before it appears", !early.offerPresent, `offerPresent=${early.offerPresent}`);
  await page.waitForTimeout(4500);

  const shown = await measure(page);
  console.log(`    measured: ${JSON.stringify(shown)}`);
  // Visual evidence of the offer in place, next to the member rows.
  await page.screenshot({ path: "/tmp/opencode/b4-install-offer.png" });
  check("the offer appears", shown.offerPresent, `height=${shown.offerHeight}px`);
  check("the offer is compact (one row)", shown.offerHeight <= 56, `height=${shown.offerHeight}px`);
  check(
    "the offer does not cover the bottom navigation",
    !shown.overlapsNavigation,
    `navTop=${shown.navTop}`,
  );
  check(
    "the offer does not block the content beneath it",
    !shown.blocksContent,
    `the element under the offer is the offer itself: ${shown.blocksContent}`,
  );
  check(
    "the offer is a corner sliver, never a full row",
    shown.offerHeight <= 56 && shown.offerWidth <= 160,
    `${shown.offerWidth}x${shown.offerHeight}px`,
  );

  // It leaves on its own.
  await page.waitForTimeout(11_000);
  const after = await measure(page);
  check("the offer leaves on its own", !after.offerPresent, `offerPresent=${after.offerPresent}`);

  await browser.close();
  console.log(failures === 0 ? "\nGeometry check passed." : `\n${failures} geometry check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
