// COPIED from the Root's coordination script (work/owner-light-implementation-20261102/create-desktop-chrome.cjs).
// Purpose: the ACTUAL browser regression for the desktop create-action plus — it
// measures the icon's real box (`iconWidth >= 18`) on /owner/members and
// /owner/staff at 1280. The Root runs it on the combined artifact through
// owner_preview.py; the unit guard in owner-create-action-desktop-plus.test.tsx
// only pins the rendered cause. Not run from this lane (no preview server here).
//
// The three CommonJS `require()` calls of the copied script are expressed as
// async dynamic imports. `playwright` is imported by its package name, which
// resolves from this file's own location (the repository's node_modules), as
// the original `require(path.join(process.cwd(), 'node_modules/playwright'))`
// did. Nothing else about the measurement, the login, the assertions or the
// output changed.
const base = process.env.AQUA_E2E_BASE_URL,
  out = process.env.AQUA_E2E_OUT;
if (!base || !out) throw Error("Owned preview required");
(async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { chromium } = await import("playwright");
  const b = await chromium.launch({ channel: "chrome", headless: true }),
    c = await b.newContext({ viewport: { width: 1280, height: 900 } }),
    p = await c.newPage();
  const checks = [],
    errors = [];
  try {
    await p.goto(base + "/login");
    const sign = p.getByRole("button", { name: "Sign in", exact: true });
    for (let i = 0; i < 35; i++) {
      await p.locator("#login-phone").fill("+919000000001");
      await p.locator("#login-pin").fill("123456");
      await p.locator("#login-pin").blur();
      if (await sign.isEnabled()) break;
      await p.waitForTimeout(200);
    }
    await sign.click();
    await p.waitForURL((u) => u.pathname === "/owner");
    for (const route of ["/owner/members", "/owner/staff"]) {
      await p.goto(base + route);
      const create = p.locator("[data-owner-create-action]");
      await create.waitFor({ state: "visible" });
      const info = await create.evaluate((e) => {
        const icon = e.querySelector("svg"),
          r = icon.getBoundingClientRect();
        return {
          href: e.getAttribute("href"),
          label: e.textContent.trim(),
          iconWidth: r.width,
          iconHeight: r.height,
          iconDisplay: getComputedStyle(icon).display,
          buttonWidth: e.getBoundingClientRect().width,
        };
      });
      const ok = info.iconWidth >= 18 && info.iconHeight >= 18 && !!info.label;
      checks.push({ route, ok, ...info });
      if (!ok)
        errors.push({
          route,
          reason: "Desktop create action is missing its visible plus glyph",
          ...info,
        });
      await p.screenshot({
        path: path.join(out, route.replaceAll("/", "_") + ".png"),
        caret: "initial",
      });
    }
  } finally {
    await c.close();
    await b.close();
    fs.writeFileSync(
      path.join(out, "create-desktop.json"),
      JSON.stringify({ checks, errors }, null, 2) + "\n",
    );
  }
  console.log(JSON.stringify({ checks, errors }));
  process.exitCode = errors.length ? 1 : 0;
})();
