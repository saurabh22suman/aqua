// Isolated Chrome check; invoke only through lane_job.py + preview_job.py.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { chromium, type BrowserContext, type Page } from "playwright";
import { privilegedFixturePool as admin } from "../tests/db/privileged-fixture";
import { env } from "@/lib/env";
import { provisionPlatformUser, markTotpEnrolled, currentTotpCode, verifyTotp } from "@/db/platform-auth";
import { pool } from "@/db/client";

const local = new URL(process.env.AQUA_E2E_BASE_URL ?? "http://invalid");
assert.equal(local.hostname, "127.0.0.1");
assert.match(new URL(env.DATABASE_URL).pathname, /^\/aqua_test_/);
const base = `http://ops.localhost:${local.port}`;
const out = process.env.AQUA_E2E_OUT ?? "docs/handoffs/evidence/ops-security-20261027/browser";
const ids: string[] = [];
const checks: { name: string; status: string; error?: string }[] = [];
async function check(name: string, run: () => Promise<void>) {
  if (process.env.AQUA_E2E_ONLY_NATIVE === "1" && !name.startsWith("native")) return;
  try { await run(); checks.push({ name, status: "PASS" }); console.log(`PASS ${name}`); }
  catch (error) { checks.push({ name, status: "FAIL", error: error instanceof Error ? error.message : "Unknown failure" }); console.log(`FAIL ${name}`); }
}
async function makeOperator(role: "admin" | "viewer") {
  const email = `browser-${randomUUID()}@example.test`, password = `Synthetic-${randomUUID()}`;
  const result = await provisionPlatformUser({ email, password, name: "Security browser fixture", role });
  ids.push(result.id); await markTotpEnrolled(result.id);
  return { ...result, email, password };
}
async function enterPassword(page: Page, user: Awaited<ReturnType<typeof makeOperator>>) {
  await page.goto(`${base}/ops/login`);
  await page.getByLabel("Email", { exact: true }).fill(user.email);
  await page.getByLabel("Password", { exact: true }).fill(user.password);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.waitForURL("**/ops/verify");
  await page.getByRole("heading", { name: "Authenticator code", exact: true }).waitFor();
}
async function finish(page: Page, user: Awaited<ReturnType<typeof makeOperator>>) {
  await page.getByLabel("6-digit code", { exact: true }).fill(currentTotpCode(user.totpSecret));
  await page.waitForURL(`${base}/ops`);
  await page.getByRole("navigation", { name: "Platform", exact: true }).getByText("Overview", { exact: true }).waitFor();
}
async function noOverflow(page: Page) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
}
async function main() {
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let context: BrowserContext | undefined;
  try {
    await mkdir(out, { recursive: true });
    const identity = (await admin.query("select current_database() as name")).rows[0].name;
    assert.match(identity, /^aqua_test_/);
    const owner = await makeOperator("admin"), viewer = await makeOperator("viewer");
    browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--host-resolver-rules=MAP ops.localhost 127.0.0.1"] });
    context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await context.newPage(); page.setDefaultTimeout(30_000);
    await check("public login has labelled password controls and no authenticated navigation", async () => {
      await page.goto(`${base}/ops/login`); await page.getByLabel("Email", { exact: true }).waitFor();
      assert.equal(await page.getByLabel("Password", { exact: true }).getAttribute("type"), "password");
      assert.equal(await page.getByRole("link", { name: "Tenants", exact: true }).count(), 0);
      await noOverflow(page); await page.screenshot({ path: `${out}/login-1280.png` });
      await page.getByLabel("Password", { exact: true }).focus();
      await page.keyboard.press("Tab");
      const focus = await page.getByRole("button", { name: "Continue", exact: true }).evaluate(button => {
        const style = getComputedStyle(button);
        return { active: document.activeElement === button, style: style.outlineStyle, width: parseFloat(style.outlineWidth), colour: style.outlineColor };
      });
      assert.equal(focus.active, true); assert.notEqual(focus.style, "none"); assert.ok(focus.width >= 2, "Continue needs a visible 2px keyboard focus ring");

    });
    await check("wrong password fails without leaking credentials or issuing a cookie", async () => {
      const sentinel = "Synthetic-leak-canary";
      await page.getByLabel("Email", { exact: true }).fill(owner.email);
      await page.getByLabel("Password", { exact: true }).fill(sentinel);
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      await page.getByRole("alert").filter({ hasText: "Wrong email or password." }).waitFor();
      assert.equal(page.url().includes(sentinel), false);
      assert.equal((await context!.cookies()).some(c => c.name === "platform_session"), false);
    });
    await check("password requires authenticator and pending cookie cannot enter Ops", async () => {
      await enterPassword(page, owner);
      assert.equal(await page.getByRole("link", { name: "Tenants", exact: true }).count(), 0);
      await page.goto(`${base}/ops/tenants/new`); await page.waitForURL("**/ops/verify");
      await page.getByRole("heading", { name: "Authenticator code", exact: true }).waitFor();
      await noOverflow(page); await page.screenshot({ path: `${out}/verify-1280.png` });
    });
    await check("wrong authenticator fails; a valid code opens Ops", async () => {
      const wrong = ["000000", "111111", "222222"].find(code => !verifyTotp(owner.totpSecret, code))!;
      await page.getByLabel("6-digit code", { exact: true }).fill(wrong);
      await page.getByRole("alert").waitFor(); assert.match(page.url(), /\/ops\/verify$/);
      await page.waitForFunction(() => (document.querySelector<HTMLInputElement>('input[name="code"]'))?.value === "");
      await finish(page, owner); await noOverflow(page);
      await page.screenshot({ path: `${out}/ops-1280.png` });
    });
    await check("Ops cookie is host-only; tenant host cannot open Ops", async () => {
      const cookie = (await context!.cookies()).find(c => c.name === "platform_session");
      assert.equal(cookie?.domain, "ops.localhost"); assert.equal(cookie?.httpOnly, true); assert.equal(cookie?.sameSite, "Lax");
      const response = await page.goto(`${local.origin}/ops/login`); assert.equal(response?.status(), 404);
      assert.equal((await context!.cookies(local.origin)).some(c => c.name === "platform_session"), false);
    });
    await check("legacy same-origin WhatsApp Ops login is refused", async () => {
      const response = await context!.request.post(`${local.origin}/ops/api/whatsapp-auth`, {
        headers: { origin: base, host: `ops.localhost:${local.port}` }, data: { intent: "request", phone: "+919000009876" },
      });
      assert.equal(response.status(), 403); assert.equal(response.headers()["set-cookie"], undefined);
    });
    await check("logout revokes the cookie and persisted session", async () => {
      await page.goto(`${base}/ops`);
      await page.locator("aside").getByRole("button", { name: "Sign out", exact: true }).click();
      await page.waitForURL("**/ops/login");
      assert.equal((await admin.query("select id from platform_sessions where user_id=$1", [owner.id])).rows.length, 0);
    });
    await check("viewer authenticates with two factors and sees read-only identity", async () => {
      await enterPassword(page, viewer); await finish(page, viewer);
      await page.getByText("Read-only: this account can browse, not change, platform data.", { exact: true }).waitFor();
    });
    await context.close(); context = undefined;
    await check("native password and authenticator forms work before JavaScript hydration", async () => {
      const nativeUser = await makeOperator("admin");
      const native = await browser!.newContext({ viewport: { width: 1280, height: 900 } });
      // Keep Next's inline streaming reveal, but withhold React/client bundles.
      // This reproduces the visible pre-hydration native submit window.
      await native.route(url => url.pathname.includes("/_next/static/") && url.pathname.endsWith(".js"), route => route.abort());
      try {
        const nativePage = await native.newPage(); nativePage.setDefaultTimeout(30_000);
        await enterPassword(nativePage, nativeUser);
        await nativePage.getByLabel("6-digit code", { exact: true }).fill(currentTotpCode(nativeUser.totpSecret));
        assert.equal(await nativePage.getByRole("button", { name: "Verify", exact: true }).isEnabled(), true);
        await nativePage.getByRole("button", { name: "Verify", exact: true }).click();
        await nativePage.waitForURL(`${base}/ops`);
      } finally { await native.close(); }
    });
  } finally {
    await context?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    try {
      await admin.query("delete from platform_audit_log where actor_id=any($1::uuid[])", [ids]);
      await admin.query("delete from platform_sessions where user_id=any($1::uuid[])", [ids]);
      await admin.query("delete from platform_users where id=any($1::uuid[])", [ids]);
    } finally {
      await admin.end(); await pool.end();
    }
    await writeFile(`${out}/results.json`, JSON.stringify({ browser: "Chrome", viewport: "1280x900", checks }, null, 2));
  }
  if (checks.some(c => c.status === "FAIL")) process.exitCode = 1;
}
main().catch(() => { console.error("Browser setup/check failed; inspect bounded preview evidence."); process.exitCode = 2; });
