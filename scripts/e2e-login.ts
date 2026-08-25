import { chromium } from "playwright";
import { spawn, type ChildProcess } from "node:child_process";

const BASE = "http://localhost:3211";
const ROLES: { phone: string; expect: string }[] = [
  { phone: "+91 90000 00001", expect: "/owner" },
  { phone: "+91 90000 00002", expect: "/coach" },
  { phone: "+91 90000 00003", expect: "/parent" },
];

async function waitForServer(proc: ChildProcess): Promise<void> {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/login`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  console.error("dev server never came up");
  proc.kill();
  process.exit(1);
}

async function main() {
  const server = spawn("pnpm", ["next", "dev", "-p", "3211"], {
    stdio: "ignore",
    detached: true,
  });
  await waitForServer(server);

  const browser = await chromium.launch();
  let failures = 0;

  for (const role of ROLES) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    try {
      await page.goto(`${BASE}/login`);
      await page.getByPlaceholder("+91 98765 43210").fill(role.phone);
      await page.getByRole("button", { name: "Send code" }).click();

      const hint = page.locator("text=dev code:");
      await hint.waitFor({ timeout: 15_000 });
      const code = (await hint.textContent())!.replace(/\D/g, "").slice(-6);

      await page.getByPlaceholder("••••••").fill(code);
      await page.getByRole("button", { name: "Verify and continue" }).click();

      await page.waitForURL(`**${role.expect}`, { timeout: 15_000 });
      console.log(`[✓] ${role.phone} → ${page.url().replace(BASE, "")} (expected ${role.expect})`);
    } catch (err) {
      failures++;
      console.log(`[✗] ${role.phone} failed: ${(err as Error).message.split("\n")[0]}`);
      if (process.env.DEBUG) {
        console.log("   url:", page.url());
        console.log("   body:", (await page.locator("body").textContent().catch(() => ""))?.slice(0, 200));
        console.log("   cookies:", (await context.cookies()).map((c) => c.name).join(",") || "none");
      }
    } finally {
      await context.close();
    }
  }

  await browser.close();
  if (server.pid) process.kill(-server.pid!);
  process.exit(failures === 0 ? 0 : 1);
}

main();
