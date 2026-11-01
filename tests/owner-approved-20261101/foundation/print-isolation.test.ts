// @vitest-environment node
import { readFileSync } from "node:fs";
import postcss from "postcss";
import { chromium, type Browser, type Page } from "playwright";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const source = postcss.parse(readFileSync("app/globals.css", "utf8"));
const printRules: string[] = [];
source.walkAtRules("media", rule => { if (rule.params.trim() === "print") printRules.push(rule.toString()); });
let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ headless: true }); });
afterAll(async () => { await browser?.close(); });

async function fixture(markup: string): Promise<Page> {
  const page = await browser.newPage();
  // Tailwind generates this utility separately from the source print-isolation block.
  await page.setContent(`<style>${printRules.join("\n")} @media print { .print\\:hidden { display: none !important; } }</style>${markup}`);
  return page;
}

describe("actual print-isolation CSS in Chromium", () => {
  it("prints the nested owner QR poster and fallback, not chrome or surrounding content", async () => {
    const page = await fixture(`<header id="chrome">Header</header><main><div id="shell"><aside id="sidebar">Sidebar private</aside><div><div id="page"><h1 id="heading">Check-in</h1><div><section class="print-isolate-block" data-print-isolate="premises-qr"><h2 id="poster">Staff check-in</h2><p id="fallback">Printable fallback URL</p><a id="screen-link" class="print:hidden">Open check-in page</a></section><button id="print-button">Print poster</button></div></div></div></div></main><nav aria-label="Primary" id="nav">Navigation</nav>`);
    try {
      expect(await page.locator("#poster").isVisible()).toBe(true);
      expect(await page.locator("#screen-link").isVisible()).toBe(true);
      expect(await page.locator("#heading").isVisible()).toBe(true);
      await page.emulateMedia({ media: "print" });
      expect(await page.locator("#poster").isVisible()).toBe(true);
      expect(await page.locator("#fallback").isVisible()).toBe(true);
      for (const id of ["chrome", "sidebar", "heading", "screen-link", "print-button", "nav"]) expect(await page.locator(`#${id}`).isVisible(), id).toBe(false);
    } finally { await page.close(); }
  });

  it("keeps only the direct member ID card on paper", async () => {
    const page = await fixture(`<main><div class="print-isolate-block"><section data-print-isolate="member-id-card" class="id-card"><header id="card-header">Card heading</header><p id="card">ID card</p></section></div><h1 id="private">Member profile</h1></main>`);
    try {
      await page.emulateMedia({ media: "print" });
      expect(await page.locator("#card").isVisible()).toBe(true);
      expect(await page.locator("#card-header").isVisible()).toBe(true);
      expect(await page.locator("#private").isVisible()).toBe(false);
    } finally { await page.close(); }
  });

  it("isolates a nested member card without exposing sibling personal details", async () => {
    const page = await fixture(`<main><div><div><h1 id="private">Private member profile</h1><details open><summary id="summary">Other tools</summary><div id="private-tools">Private tools</div><div class="print-isolate-block"><section data-print-isolate="member-id-card"><p id="card">ID card</p></section></div></details></div></div></main>`);
    try {
      await page.emulateMedia({ media: "print" });
      expect(await page.locator("#card").isVisible()).toBe(true);
      for (const id of ["private", "private-tools", "summary"]) expect(await page.locator(`#${id}`).isVisible(), id).toBe(false);
    } finally { await page.close(); }
  });

  it("does not hide normal receipt content without an isolate", async () => {
    const page = await fixture(`<main><article id="receipt"><p>Receipt details</p></article><section id="other">Other content</section></main>`);
    try {
      await page.emulateMedia({ media: "print" });
      expect(await page.locator("#receipt").isVisible()).toBe(true);
      expect(await page.locator("#other").isVisible()).toBe(true);
    } finally { await page.close(); }
  });
});
