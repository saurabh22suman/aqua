import { chromium } from "playwright";

// Run against an authenticated disposable owner fixture and a production build:
// AQUA_FEES_GEOMETRY_URL=http://localhost:PORT/owner/fees?... \
// AQUA_FEES_STORAGE_STATE=/private/path/state.json pnpm exec tsx this-file
const url = process.env.AQUA_FEES_GEOMETRY_URL;
const storageState = process.env.AQUA_FEES_STORAGE_STATE;
if (!url || !storageState) throw new Error("Provide an isolated owner URL and storage-state path");
const target = new URL(url);
if (!["localhost", "127.0.0.1"].includes(target.hostname)) throw new Error("Only an isolated local fixture is permitted");

async function main() {
  const browser = await chromium.launch();
  try {
    for (const width of [320, 390, 1280]) {
      const context = await browser.newContext({ storageState, viewport: { width, height: 844 }, hasTouch: width < 600 });
      try {
        const page = await context.newPage();
        await page.goto(url!, { waitUntil: "networkidle" });
        for (const name of ["From date", "Through date"]) {
          const input = page.getByLabel(name, { exact: true });
          await input.waitFor({ state: "visible" });
          const result = await input.evaluate((element: HTMLInputElement) => {
            const style = getComputedStyle(element);
            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            if (!ctx) throw new Error("Canvas unavailable");
            ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
            return { value: element.value, available: element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight), required: ctx.measureText(element.value).width };
          });
          if (!/^\d{2}\/\d{2}\/\d{4}$/.test(result.value) || result.available + 0.5 < result.required) {
            throw new Error(`${width}px ${name}: date does not fit (${JSON.stringify(result)})`);
          }
          console.log(`${width}px ${name}: ${result.available.toFixed(1)}px available, ${result.required.toFixed(1)}px required`);
        }
        const balances = page.getByRole("group", { name: "Current balances" });
        await balances.waitFor({ state: "visible" });
        const geometry = await balances.locator('[data-testid="stat-card"]').evaluateAll((cards) => cards.map((card) => {
          const value = card.querySelector<HTMLElement>(".kpi");
          if (!value) throw new Error("Balance card missing value");
          const range = document.createRange();
          range.selectNodeContents(value);
          const lines = new Set(Array.from(range.getClientRects()).filter((r) => r.width > 0).map((r) => Math.round(r.top)));
          const cardRect = card.getBoundingClientRect();
          const valueRect = value.getBoundingClientRect();
          return { value: value.textContent, scrollWidth: value.scrollWidth, clientWidth: value.clientWidth, lines: lines.size, top: cardRect.top, valueRight: valueRect.right, cardRight: cardRect.right };
        }));
        if (geometry.length !== 2) throw new Error(`${width}px: expected two current balance cards`);
        for (const item of geometry) {
          if (!item.value?.includes("₹") || item.scrollWidth > item.clientWidth || item.lines !== 1 || item.valueRight > item.cardRight + 0.5) {
            throw new Error(`${width}px: balance value clips or wraps (${JSON.stringify(item)})`);
          }
        }
        if (width >= 390 && Math.abs(geometry[0]!.top - geometry[1]!.top) > 1) throw new Error(`${width}px: balance cards no longer share a row`);
        console.log(`${width}px balances: ${JSON.stringify(geometry)}`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
        if (overflow) throw new Error(`${width}px: horizontal page overflow`);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}
void main();
