import { chromium } from "playwright";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";

// Self-contained, synthetic and disposable. Never seeds or resets the demo DB.
export async function runOfflinePrivacy() {
  const port = await new Promise<number>((resolve, reject) => {
    const probe = createServer(); probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") return reject(new Error("No test port"));
      probe.close(() => resolve(address.port));
    });
  });
  const base = `http://localhost:${port}`;
  const container = await new PostgreSqlContainer("postgres:16").start();
  Object.assign(process.env, { AQUA_NO_DOTENV: "1", NODE_ENV: "test", DEMO_MODE: "false",
    DATABASE_URL: `postgresql://app_login:privacy-test@${container.getHost()}:${container.getPort()}/${container.getDatabase()}`,
    MIGRATION_DATABASE_URL: container.getConnectionUri(), APP_LOGIN_PASSWORD: "privacy-test",
    BETTER_AUTH_SECRET: "offline-privacy-test-secret-at-least-32-characters", BETTER_AUTH_URL: base,
    PARENT_LINK_SECRET: "offline-privacy-parent-secret-at-least-32-characters", OFFLINE_SYNC_ENABLED: "true" });
  delete process.env.WHATSAPP_PROVIDER; delete process.env.WHATSAPP_MOCK_URL;
  let server: ReturnType<typeof spawn> | undefined;
  const admin = new Pool({ connectionString: container.getConnectionUri() });
  const browser = await chromium.launch();
  try {
    execFileSync("pnpm", ["db:deploy"], { env: process.env, timeout: 90_000, stdio: "pipe" });
    execFileSync("pnpm", ["seed"], { env: process.env, timeout: 90_000, stdio: "pipe" });
    const { setupOfflineFixture, setOfflineSyncEnabled } = await import("../../scripts/lib/offline-fixture");
    const fixture = await setupOfflineFixture(admin, `privacy-${Date.now()}`, 2);
    await setOfflineSyncEnabled(admin, fixture.tenantId, true);
    server = spawn("pnpm", ["dev", "--port", String(port)], { env: process.env, detached: true, stdio: "pipe" });
    server.stdout?.on("data", data => process.stdout.write(data));
    server.stderr?.on("data", data => process.stderr.write(data));
    for (let attempt = 0; attempt < 120; attempt++) {
      try { if ((await fetch(`${base}/api/health`)).status < 500) break; } catch {}
      if (attempt === 119) throw new Error("Privacy test server did not start");
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(`${base}/login`); await page.waitForLoadState("networkidle");
    await page.getByRole("textbox", { name: "Mobile number", exact: true }).fill("+919000000002");
    await page.getByLabel("PIN", { exact: true }).fill("123456");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(`${base}/coach`, { timeout: 60_000 });
    const registerUrl = `${base}/coach/register/${fixture.sessionId}`;
    const { waitForOfflineCopy } = await import("../../scripts/lib/offline-page");
    async function warm(url: string) {
      await page.goto(url); await page.waitForLoadState("networkidle");
      const state = await page.evaluate(async () => (await fetch("/api/offline/session")).json());
      if (!state.identity) throw new Error("Authenticated offline identity unavailable");
      await waitForOfflineCopy(page, url, state.identity.scope);
    }
    await warm(registerUrl); await warm(`${base}/coach/me`); await warm(registerUrl);
    // Both pages must coexist in the same scope; this also guards against
    // an old route's asynchronous cleanup wiping a newly warmed cache.
    const scope = await page.evaluate(async () => (await (await fetch("/api/offline/session")).json()).identity.scope);
    await waitForOfflineCopy(page, `${base}/coach/me`, scope);
    const privateName = await page.locator(`[data-member-id="${fixture.memberIds[0]}"]`).innerText();
    await context.setOffline(true);
    await page.getByTestId(`mark-present-${fixture.memberIds[0]}`).click();
    await page.waitForFunction(() => Boolean(window.__waitForPendingWrites));
    await page.evaluate(() => window.__waitForPendingWrites?.());
    await page.reload();
    await page.locator(`[data-member-id="${fixture.memberIds[0]}"]`).waitFor({ timeout: 30_000 });
    await page.waitForFunction(memberId => document.querySelector(`[data-member-id="${memberId}"]`)?.getAttribute("data-status") === "present",
      fixture.memberIds[0], { timeout: 30_000 });
    await page.goto(`${base}/coach/me`);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByRole("button", { name: "Discard drafts and sign out" }).waitFor();
    await page.getByRole("button", { name: "Stay signed in" }).click();
    if (page.url() !== `${base}/coach/me`) throw new Error("Pending drafts caused an implicit logout");
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await page.getByRole("button", { name: "Discard drafts and sign out" }).waitFor();
    await context.setOffline(false);
    await page.getByRole("button", { name: "Discard drafts and sign out" }).click();
    await page.waitForURL(`${base}/login`, { timeout: 30_000 });
    const session = await page.evaluate(async () => (await fetch("/api/auth/get-session")).json());
    if (session !== null) throw new Error("Logout did not revoke the server session");
    const privateCaches = await page.evaluate(async () => (await caches.keys()).filter(name => name.startsWith("aqua-private-")));
    if (privateCaches.length) throw new Error("Private HTML survived logout");
    await context.setOffline(true);
    await page.goto(registerUrl, { timeout: 15_000 }).catch(() => {});
    const text = await page.locator("body").innerText().catch(() => "");
    if (text.includes(privateName) || text.includes("Offline Test Member")) throw new Error("Signed-out offline navigation exposed roster data");
    async function signIn(phone: string, target: string) {
      await context.setOffline(false);
      await page.goto(`${base}/login`); await page.waitForLoadState("networkidle");
      await page.getByRole("textbox", { name: "Mobile number", exact: true }).fill(phone);
      await page.getByLabel("PIN", { exact: true }).fill("123456");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page.waitForURL(`${base}/${target}`, { timeout: 30_000 });
    }
    await signIn("+919000000002", "coach"); await warm(registerUrl);
    let leaseWorker = context.serviceWorkers()[0];
    for (const worker of context.serviceWorkers()) {
      const urls = await worker.evaluate<string[]>("(async () => (await self.clients.matchAll()).map(client => client.url))()");
      if (urls.includes(registerUrl)) leaseWorker = worker;
    }
    if (!leaseWorker) throw new Error("No worker owns the cached register");
    await leaseWorker.evaluate(() => {
      Object.defineProperty(globalThis, "__realDateNow", { value: Date.now, configurable: true });
      const future = Date.now() + 31 * 24 * 60 * 60_000; Date.now = () => future;
    });
    await context.setOffline(true); await page.goto(registerUrl).catch(() => {});
    if ((await page.locator("body").innerText()).includes("Offline Test Member")) throw new Error("Expired lease exposed cached roster");
    await leaseWorker.evaluate(() => { Date.now = Reflect.get(globalThis, "__realDateNow") as typeof Date.now; });
    await signIn("+919000000002", "coach"); await warm(registerUrl);
    // Account switch without relying on the ordinary logout control.
    await signIn("+919000000005", "reception"); await page.waitForLoadState("networkidle");
    const clearedDeadline = Date.now() + 30_000;
    while (await page.evaluate(async () => (await caches.keys()).some(name => name.startsWith("aqua-private-")))) {
      if (Date.now() > clearedDeadline) throw new Error("Private cache did not clear after account switch");
      await page.waitForTimeout(100);
    }
    await context.setOffline(true); await page.goto(registerUrl).catch(() => {});
    if ((await page.locator("body").innerText()).includes("Offline Test Member")) throw new Error("Account switch retained readable coach roster");
    console.log("PASS: scoped reload, draft decision, logout revocation, expiry and account-switch cache confidentiality.");
    await context.close();
  } catch (error) {
    const page = browser.contexts()[0]?.pages()[0];
    if (page) {
      console.error("Privacy browser failure", JSON.stringify({ url: page.url(), body: await page.locator("body").innerText().catch(() => ""),
        caches: await page.evaluate(async () => {
          const result = [];
          for (const name of await caches.keys()) {
            const cache = await caches.open(name);
            const keys = await cache.keys();
            const meta = name === "aqua-offline-state-v2" ? await (await cache.match(keys[0]))?.json() : undefined;
            result.push({ name, urls: keys.map(request => request.url), meta });
          }
          return result;
        }).catch(() => []) }, null, 2));
      await page.screenshot({ path: ".playwright-mcp/offline-privacy-failure.png" }).catch(() => {});
    }
    throw error;
  } finally {
    await browser.close();
    if (server?.pid) { try { process.kill(-server.pid, "SIGTERM"); } catch {} }
    await admin.end();
    const { pool } = await import("@/db/client"); await pool.end();
    await container.stop();
  }
}
