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
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
        if (overflow) throw new Error(`${width}px: horizontal page overflow`);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
}
void main();
