import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";

const BASE = "http://localhost:3213";

async function waitForServer(proc: ChildProcess): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(`${BASE}/login`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  proc.kill();
  process.exit(1);
}

async function main() {
  const server = spawn("pnpm", ["next", "dev", "-p", "3213"], {
    stdio: "ignore",
    detached: true,
  });
  await waitForServer(server);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
  });
  const page = await context.newPage();

  try {
    await page.goto(`${BASE}/login`);
    await page.getByPlaceholder("+91 98765 43210").fill("+91 90000 00002");
    await page.getByRole("button", { name: "Send code" }).click();
    const hint = page.locator("[data-testid=dev-code]");
    await hint.waitFor({ timeout: 15_000 });
    const code = (await hint.textContent())!.replace(/\D/g, "").slice(-6);
    await page.getByPlaceholder("••••••").fill(code);
    await page.getByRole("button", { name: "Verify and continue" }).click();
    await page.waitForURL("**/coach", { timeout: 15_000 });

    await page.locator("a[href^='/coach/register/']").first().click();
    await page.waitForURL("**/coach/register/**");
    await page.locator("li button", { hasText: "Present" }).first().waitFor();

    const rows = await page.locator("ul > li").count();
    console.log(`roster rows: ${rows}`);

    const probe = `(async () => {
      const buttons = Array.from(document.querySelectorAll("ul li button")).filter(
        (b) => b.textContent === "Present",
      );
      const latencies = [];
      const t0 = performance.now();
      for (const btn of buttons) {
        const before = performance.now();
        btn.click();
        await new Promise((resolve) => {
          const check = () => {
            if (btn.className.includes("bg-good-soft")) resolve();
            else requestAnimationFrame(check);
          };
          requestAnimationFrame(check);
        });
        latencies.push(performance.now() - before);
        await new Promise((r) => setTimeout(r, 120));
      }
      return {
        count: buttons.length,
        totalMs: Math.round(performance.now() - t0),
        avgMs: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
        maxMs: Math.round(Math.max(...latencies)),
      };
    })()`;

    const result = await page.evaluate<{ count: number; totalMs: number; avgMs: number; maxMs: number }>(probe);
    console.log(
      `marked ${result.count} students in ${result.totalMs}ms total ` +
        `(${(result.totalMs / 1000).toFixed(1)}s) · optimistic paint avg ${result.avgMs}ms, max ${result.maxMs}ms`,
    );

    await page.waitForTimeout(2500);
    const header = await page
      .locator("text=/\\d+ of \\d+ marked/")
      .first()
      .textContent();
    console.log(`header after settle: ${header?.trim()}`);
  } finally {
    await browser.close();
    if (server.pid) process.kill(-server.pid!);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
