// Owner light — FOUNDATION lane — the Notes-tab boundary RED (3 November 2026).
//
// Versioned, real-Chrome regression for the observed stall: on a member
// profile, after the scoped directory → profile → Edit → Cancel flow, the
// NOTES tab does not commit (`?tab=notes` never lands) for ~30 s although the
// RSC response completes.
//
// It drives the REAL synthetic local Owner fixture and the REAL pages:
// system Chrome channel, no request interception, no CSS injection, no fake
// data, no route stubbing. It measures only what a browser can:
//
//   1. CONTROL — directory → the one searched row → profile → Edit →
//      "Edit member details" → Cancel commits back to the profile;
//   2. RED — on the profile, the "Notes" tab commits `?tab=notes` and the
//      Notes content renders, within BOUND_MS. Today the tab query never
//      lands, so this step fails.
//
// The Root runs it through owner_preview.py on the combined artifact:
//   node tests/owner-light-20261102/foundation/owner-notes-boundary-red-20261103.cjs
// with AQUA_E2E_BASE_URL and AQUA_E2E_OUT set. Nothing here is a test result.

const BASE = process.env.AQUA_E2E_BASE_URL;
const OUT = process.env.AQUA_E2E_OUT;
const BOUND_MS = 8000;
if (!BASE || !OUT) throw Error("Owned preview required");

const VIEWPORTS = [
  { name: "phone-390", width: 390, height: 844 },
  { name: "desktop-1280", width: 1280, height: 900 },
];

(async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { chromium } = await import("playwright");

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const report = { base: BASE, boundMs: BOUND_MS, viewports: [], errors: [] };

  try {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      const rsc = [];
      page.on("response", (response) => {
        const url = response.url();
        if (!/\/owner\//.test(url)) return;
        if (!/[?&]_rsc=/.test(url) && !url.endsWith("/edit") && !url.includes("?tab=")) return;
        rsc.push({ url: url.replace(BASE, ""), status: response.status() });
      });

      const step = { viewport: viewport.name, checks: [], rsc };
      const check = (name, ok, detail) => {
        step.checks.push({ name, ok, detail });
        if (!ok) report.errors.push({ viewport: viewport.name, name, detail });
      };

      try {
        // ── real synthetic Owner login ───────────────────────────────
        await page.goto(`${BASE}/login`);
        const sign = page.getByRole("button", { name: "Sign in", exact: true });
        for (let i = 0; i < 35; i += 1) {
          await page.locator("#login-phone").fill("+919000000001");
          await page.locator("#login-pin").fill("123456");
          await page.locator("#login-pin").blur();
          if (await sign.isEnabled()) break;
          await page.waitForTimeout(200);
        }
        await sign.click();
        await page.waitForURL((url) => url.pathname === "/owner");

        // ── directory → the one searched member ──────────────────────
        await page.goto(`${BASE}/owner/members`);
        await page.getByTestId("members-list").waitFor({ state: "visible" });
        await page.getByLabel("Search members").fill("Aaradhya");
        const rows = page.getByTestId("member-row");
        await rows.first().waitFor({ state: "visible" });
        const rowCount = await rows.count();
        check("the searched directory holds one row", rowCount === 1, `${rowCount} row(s)`);
        const rowHref = await rows.first().getAttribute("href");
        await rows.first().click();
        await page.waitForURL((url) => /\/owner\/members\/[^/]+$/.test(url.pathname), {
          timeout: BOUND_MS,
        });
        const profileUrl = page.url();
        check("the row opens that profile", profileUrl.includes(rowHref), profileUrl.replace(BASE, ""));

        // ── profile → Edit ───────────────────────────────────────────
        const editLink = page.locator('a[href*="/owner/members/"][href*="/edit"]').first();
        await editLink.waitFor({ state: "visible" });
        await editLink.click();
        await page.getByRole("heading", { name: /Edit member details/i }).waitFor({
          state: "visible",
          timeout: BOUND_MS,
        });
        check("the Edit page renders", true, page.url().replace(BASE, ""));
        await page.screenshot({ path: path.join(OUT, `${viewport.name}-1-edit.png`), caret: "initial" });

        // ── CONTROL: fast Cancel commits back to the profile ─────────
        const cancel = page
          .getByRole("link", { name: "Cancel", exact: true })
          .or(page.getByRole("button", { name: "Cancel", exact: true }));
        await cancel.first().waitFor({ state: "visible" });
        const cancelStarted = Date.now();
        await cancel.first().click();
        await page.waitForURL((url) => /\/owner\/members\/[^/]+$/.test(url.pathname), {
          timeout: BOUND_MS,
        });
        const cancelMs = Date.now() - cancelStarted;
        check("fast Cancel commits to the profile", !page.url().includes("/edit"), `${cancelMs}ms`);
        await page.screenshot({
          path: path.join(OUT, `${viewport.name}-2-after-cancel.png`),
          caret: "initial",
        });

        // ── RED: the Notes tab commits within the bound ──────────────
        const notesTab = page.getByRole("link", { name: "Notes", exact: true }).first();
        await notesTab.waitFor({ state: "visible" });
        const notesStarted = Date.now();
        await notesTab.click();
        let notesCommitted = false;
        try {
          await page.waitForURL((url) => url.searchParams.get("tab") === "notes", {
            timeout: BOUND_MS,
          });
          notesCommitted = true;
        } catch {
          notesCommitted = false;
        }
        const notesMs = Date.now() - notesStarted;
        check(
          "the Notes tab commits its query within the bound",
          notesCommitted,
          `${notesMs}ms — url ${page.url().replace(BASE, "")}`,
        );
        if (notesCommitted) {
          const notesVisible = await page
            .getByRole("heading", { name: /Notes/i })
            .first()
            .isVisible()
            .catch(() => false);
          check("the Notes tab renders its content", notesVisible, `${notesMs}ms`);
        }
        await page.screenshot({
          path: path.join(OUT, `${viewport.name}-3-notes.png`),
          caret: "initial",
        });
      } catch (error) {
        check("journey reached its end", false, String(error));
      } finally {
        await context.close();
      }
      report.viewports.push(step);
    }
  } finally {
    await browser.close();
    fs.writeFileSync(
      path.join(OUT, "owner-notes-boundary-red.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
  }

  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.errors.length ? 1 : 0;
})();
