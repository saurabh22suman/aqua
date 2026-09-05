// H1 — credential leak check for every pre-hydration form submit
// in the platform surface. Spawns its own dev server (matching the
// scripts/e2e-login.ts and scripts/e2e-offline.ts pattern) and
// runs Playwright against it.
//
// Three tiers:
//
//   Tier 1 (live submit, login only) — fills the platform login
//   form with sentinel strings, submits with JS disabled, asserts
//   the sentinel appears in neither the URL nor the HTML body.
//   This is the most security-critical form and the only one
//   reachable without a session; auth-gated pages redirect
//   server-side via a `<template data-dgst="NEXT_REDIRECT">`
//   rather than an HTTP 307, so a JS-disabled browser does not
//   follow the redirect — the form never renders in the
//   response HTML.
//
//   Tier 1.5 (live submit, one auth-gated form) — for the
//   invite-owner form on /platform/tenants/[id]. The test
//   logs in via the form action (JS enabled, so RSC redirect
//   templates fire and the page renders), then navigates to
//   the auth-gated form page, fills the phone field with
//   sentinel, and POSTs to the form's action URL with a
//   manual fetch. The manual fetch is the closest analog to a
//   pre-hydration native submit without React's event handlers
//   in the way: it POSTs the form data to the same URL the
//   browser would POST to, with the same body shape, but
//   without going through React's submit-event handling.
//   Asserts the sentinel appears in neither the URL nor the
//   response body.
//
//   Why one form and not all seven: each of the remaining
//   six auth-gated forms has the same render shape as
//   invite-owner (useActionState + method="post" +
//   $ACTION_REF_* hidden inputs). Tier 2 (source check) pins
//   the structural fix on all 8. Tier 1.5 pins the live
//   behaviour on one representative; the others follow by
//   structural argument. This was the user's "I'd rather have
//   one gated form proven live and seven grepped than zero
//   proven live."
//
//   Tier 2 (source check, all 8 forms) — grep each form file for
//   `method="post"` on the rendered <form> element. That's the
//   load-bearing piece of the H1 fix: a native submit on a form
//   with method="post" puts the form fields in the request body,
//   not the URL. Tier 1 confirms this on the live submit path;
//   Tier 2 confirms it on every other form statically.
//
// "All nine forms, not a representative sample" was the H1 scope
// addition — each form gets its own check. Past fixes on this
// family were tested on one instance and missed the others; this
// test pins the property per-form.
//
// action="" investigation (the second pre-hydration finding):
// the form's rendered action attribute is empty because React 19's
// Server Action protocol uses <form action={fn}> with a function
// reference and identifies the action to the server via the
// $ACTION_REF_* hidden inputs read by Next.js's RSC handler; with
// method="post" the form data (including the $ACTION_* metadata)
// goes in the body, the browser's native submit with action=""
// defaults to the current URL, and Next.js's handler dispatches
// from the body — credentials land in the body, not in the URL.
// This is React-19+ specific; React 18 would have required
// `<form action="/api/...">` with a URL, not a function.

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { createHmac, randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import {
  provisionPlatformUser,
  markTotpEnrolled,
} from "@/db/platform-auth";

const PORT = 3220;
const BASE = `http://127.0.0.1:${PORT}`;
const SENTINEL = "LEAK_CANARY_xyzzy";

type FormTarget = {
  name: string;
  source: string;
};

// The eight forms that previously had the <form onSubmit> shape;
// status-transitions is button-driven with no <form> so it's
// not in this list (verified by `grep '<form' app/(platform)/platform/
// tenants/[tenantId]/status-transitions.tsx` — zero matches).
const FORM_TARGETS: FormTarget[] = [
  {
    name: "platform login",
    source: "app/(platform)/platform/login/login-form.tsx",
  },
  {
    name: "platform verify",
    source: "app/(platform)/platform/verify/verify-form.tsx",
  },
  {
    name: "feature catalogue edit",
    source: "app/(platform)/platform/features/feature-catalogue.tsx",
  },
  {
    name: "preset detail apply",
    source: "app/(platform)/platform/presets/[key]/preset-detail-form.tsx",
  },
  {
    name: "tenant remove sample data",
    source: "app/(platform)/platform/tenants/[tenantId]/remove-sample-data-button.tsx",
  },
  {
    name: "tenant feature toggle",
    source: "app/(platform)/platform/tenants/[tenantId]/tenant-feature-toggles.tsx",
  },
  {
    name: "invite owner",
    source: "app/(platform)/platform/tenants/[tenantId]/invite-owner-form.tsx",
  },
  {
    name: "create tenant",
    source: "app/(platform)/platform/tenants/new/new-tenant-form.tsx",
  },
];

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${BASE}/login`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("dev server never came up on " + BASE);
}

async function activeTenantWithPreset(): Promise<string> {
  const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
  try {
    const t = await admin.query<{ id: string }>(
      `select id from tenants where status = 'active' and preset_key is not null limit 1`,
    );
    if (t.rows.length === 0) {
      throw new Error("no active tenant with preset — run pnpm demo:reset first");
    }
    return t.rows[0]!.id;
  } finally {
    await admin.end();
  }
}

async function seedAuthedSessionCookie(): Promise<{ cookieValue: string }> {
  const admin = new Pool({ connectionString: env.MIGRATION_DATABASE_URL });
  try {
    const email = `h1-tier1.5-${Date.now().toString(36)}@platform.test`;
    const password = `pw-h1-tier1.5-${Date.now().toString(36)}`;
    const u = await provisionPlatformUser({
      email,
      name: "H1 Tier 1.5",
      password,
      role: "admin",
    });
    await markTotpEnrolled(u.id);
    const sessionId = randomUUID();
    const token = randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
    const tokenHash = createHmac("sha256", "platform-session-token-v1")
      .update(token)
      .digest("hex");
    await admin.query(
      `insert into platform_sessions
         (id, user_id, token_hash, second_factor_passed, expires_at)
       values ($1::uuid, $2::uuid, $3, true, now() + interval '1 hour')`,
      [sessionId, u.id, tokenHash],
    );
    return { cookieValue: token };
  } finally {
    await admin.end();
  }
}

async function run(): Promise<{ failures: string[]; total: number }> {
  const failures: string[] = [];

  // Tier 2 — source check. Cheap, deterministic, runs in <10ms.
  // grep each source file for `method="post"` on a `<form` element.
  // Comments and prose that mention <form...> are stripped first
  // so they don't trigger false positives (the inventory
  // doc-comments in these files describe the fix and contain
  // literal "<form" tokens that would otherwise match).
  const stripComments = (s: string) => s.replace(/^\s*\/\/.*$/gm, "");
  const FORM_WITH_POST = /<form[^>]*\smethod=["']post["']/;
  for (const t of FORM_TARGETS) {
    let src: string;
    try {
      src = readFileSync(t.source, "utf8");
    } catch {
      failures.push(`${t.name}: cannot read source ${t.source}`);
      continue;
    }
    const stripped = stripComments(src);
    const matches = stripped.match(/<form[^>]*>/g) ?? [];
    const withPost = matches.filter((m) => FORM_WITH_POST.test(m));
    if (withPost.length === 0 || withPost.length < matches.length) {
      failures.push(`${t.name}: ${withPost.length}/${matches.length} forms have method="post" (${t.source})`);
    }
    console.log(`  ${withPost.length === matches.length && withPost.length > 0 ? "✓" : "✗"} ${t.name}: ${withPost.length}/${matches.length} forms have method="post"`);
  }

  // Tier 1 + Tier 1.5 — live submit. Spawn a dev server.
  const server = spawn("pnpm", ["next", "dev", "-p", String(PORT)], {
    stdio: "ignore",
    detached: true,
    env: process.env,
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  try {
    await waitForServer();

    // Tier 1 — login form, JS disabled. Public path.
    browser = await chromium.launch({ headless: true });
    const loginCtx = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      javaScriptEnabled: false,
    });
    const loginPage = await loginCtx.newPage();
    try {
      await loginPage.goto(`${BASE}/platform/login`, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      await loginPage.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
      await loginPage.waitForSelector("form", { timeout: 15_000, state: "attached" });
      await loginPage.evaluate(`
        (() => {
          const set = (n, v) => { const el = document.querySelector('input[name="' + n + '"]'); if (el) el.value = v; };
          set('email', '${SENTINEL}@example.com');
          set('password', '${SENTINEL}_pwd');
          document.querySelector('form').submit();
        })()
      `);
      await loginPage.waitForTimeout(2_000);
      const finalUrl = loginPage.url();
      const finalBody = await loginPage.content();
      const loginLeaks: string[] = [];
      for (const sentinel of [`${SENTINEL}@example.com`, `${SENTINEL}_pwd`]) {
        if (finalUrl.includes(sentinel)) loginLeaks.push(`URL contains "${sentinel}"`);
        if (finalBody.includes(sentinel)) loginLeaks.push(`body contains "${sentinel}"`);
      }
      if (loginLeaks.length === 0) {
        console.log(`\n  ✓ platform login (live submit, JS disabled): no credential leak in URL or body`);
      } else {
        for (const l of loginLeaks) failures.push(`platform login (live): ${l}`);
        console.log(`\n  ✗ platform login (live submit): ${loginLeaks.join(", ")}`);
      }
    } finally {
      await loginPage.close();
      await loginCtx.close();
    }

    // Tier 1.5 — auth-gated form. JS enabled (so RSC redirects
    // fire and the form renders). Seed an authed session cookie,
    // navigate to the auth-gated form page, fill with sentinels,
    // and POST via manual fetch — the closest analog to a
    // pre-hydration native submit without React's event handlers
    // in the way. We pick invite-owner because the form is
    // always rendered on the tenant detail page (no Edit-button
    // click required) and the phone field is the most natural
    // sentinel.
    const { cookieValue } = await seedAuthedSessionCookie();
    const tenantId = await activeTenantWithPreset();
    const authedCtx = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      javaScriptEnabled: true, // must be true so the form renders
    });
    await authedCtx.addCookies([
      {
        name: "platform_session",
        value: cookieValue,
        // The dev server may resolve to localhost or 127.0.0.1
        // depending on the system; Playwright's cookie jar matches
        // cookies to requests by domain. The server reaches itself
        // over 127.0.0.1 in the CI runner; use that domain so the
        // server can read the cookie on its own redirect.
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      },
    ]);
    const authedPage = await authedCtx.newPage();
    try {
      await authedPage.goto(`${BASE}/platform/tenants/${tenantId}`, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      await authedPage.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
      // Wait for the invite-owner form to attach. With JS
      // enabled the RSC stream finishes synchronously and the form
      // is in the visible area, not in a hidden Suspense boundary.
      await authedPage.waitForSelector("form input[name=phone]", {
        timeout: 15_000,
      });
      // Manual fetch = native submit. Read the form's
      // action/method attributes, build FormData from the form
      // (so the $ACTION_* hidden inputs are included), POST to
      // the action URL. This is the path a JS-disabled browser
      // takes: form.submit() goes to action="" → current URL with
      // method="post" → body has $ACTION_* + form data → server
      // dispatches. With JS on and React on, calling form.submit()
      // would still go through React's submit-event handler which
      // calls preventDefault. The manual fetch here bypasses
      // React entirely.
      const result = await authedPage.evaluate(`
        (async () => {
          const form = document.querySelector('form input[name=phone]').closest('form');
          if (!form) return { error: 'no form' };
          // Set the phone value via the form's input.
          const phone = form.querySelector('input[name=phone]');
          phone.value = '${SENTINEL}_phone';
          // Build FormData from the form (includes the
          // $ACTION_* hidden inputs).
          const formData = new FormData(form);
          const action = form.getAttribute('action') || '';
          const method = (form.getAttribute('method') || 'get').toLowerCase();
          const actionUrl = new URL(action, location.href).toString();
          const resp = await fetch(actionUrl, {
            method,
            body: formData,
            credentials: 'same-origin',
            redirect: 'follow',
          });
          return {
            pageUrl: location.href,
            finalUrl: resp.url,
            status: resp.status,
            body: await resp.text(),
          };
        })()
      `) as {
        pageUrl: string;
        finalUrl: string;
        status: number;
        body: string;
        error?: string;
      };
      if (result.error) {
        failures.push(`invite owner (tier 1.5): ${result.error}`);
        console.log(`\n  ✗ invite owner (tier 1.5): ${result.error}`);
      } else {
        const leaks: string[] = [];
        const sentinel = `${SENTINEL}_phone`;
        for (const field of ["pageUrl", "finalUrl", "body"] as const) {
          if (result[field].includes(sentinel)) {
            leaks.push(`${field} contains "${sentinel}"`);
          }
        }
        if (leaks.length === 0) {
          console.log(
            `  ✓ invite owner (tier 1.5, manual fetch simulating native submit): no credential leak in URL or body`,
          );
        } else {
          for (const l of leaks) failures.push(`invite owner (tier 1.5): ${l}`);
          console.log(`  ✗ invite owner (tier 1.5): ${leaks.join(", ")}`);
        }
      }
    } finally {
      await authedPage.close();
      await authedCtx.close();
    }
  } finally {
    if (browser) await browser.close();
    if (server.pid) process.kill(-server.pid);
  }

  return { failures, total: FORM_TARGETS.length };
}

run()
  .then(({ failures, total }) => {
    if (failures.length === 0) {
      console.log(`\n✓ H1 credential-leak check passed for all ${total} forms (live submit × 2 + source).`);
      process.exit(0);
    } else {
      console.error(`\n✗ H1 credential-leak check failed (${failures.length} of ${total} forms):`);
      for (const f of failures) console.error("    " + f);
      process.exit(1);
    }
  })
  .catch((err) => {
    console.error("H1 credential-leak check crashed:", err);
    process.exit(2);
  });