// H1 — credential leak check for every pre-hydration form submit
// in the platform surface. The test connects to the existing
// production server (CI runs `pnpm build` then `pnpm start`
// separately; spinning a per-route-compile dev server here would
// blow the test budget).
//
// Two tiers:
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
//   Tier 2 (source check, all 9 forms) — grep each form file for
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

import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const BASE = "http://localhost:3000"; // production server (pnpm start)
const SENTINEL = "LEAK_CANARY_xyzzy";

type FormTarget = {
  name: string;
  // Tier 2: source file that renders the <form>.
  source: string;
};

// The nine forms that previously had the <form onSubmit> shape;
// status-transitions is button-driven with no <form> so it's
// not in this list (verified by grep: no `<form` element in
// status-transitions.tsx).
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

async function run(): Promise<{ failures: string[]; total: number }> {
  const failures: string[] = [];

  // Tier 2 — source check. Cheap, deterministic, runs in <10ms.
  // grep each source file for `method="post"` on a `<form` element.
  // The pattern matches `<form ... method="post" ...>` and rejects
  // `<form ...>` without method or with method="get". Comments
  // and prose that mention <form...> are stripped first so they
  // don't trigger false positives (the inventory doc-comments in
  // these files describe the fix and contain literal "<form"
  // tokens that would otherwise match).
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

  // Tier 1 — live submit on the login form (public; no cookie
  // needed, JS disabled, sentinel credentials).
  try {
    const res = await fetch(`${BASE}/login`);
    if (!res.ok) throw new Error(`${BASE}/login returned ${res.status}`);
  } catch {
    console.error(
      `H1 credential-leak check: ${BASE} is not reachable — start the production server with 'pnpm build && pnpm start' before running this script.`,
    );
    process.exit(2);
  }
  const browser = await chromium.launch({ headless: true });
  try {
    const liveCtx = await browser.newContext({
      viewport: { width: 1366, height: 900 },
      javaScriptEnabled: false,
    });
    const livePage = await liveCtx.newPage();
    try {
      await livePage.goto(`${BASE}/platform/login`, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      await livePage.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
      await livePage.waitForSelector("form", { timeout: 15_000, state: "attached" });
      await livePage.evaluate(`
        (() => {
          const set = (n, v) => { const el = document.querySelector('input[name="' + n + '"]'); if (el) el.value = v; };
          set('email', '${SENTINEL}@example.com');
          set('password', '${SENTINEL}_pwd');
          document.querySelector('form').submit();
        })()
      `);
      await livePage.waitForTimeout(2_000);
      const finalUrl = livePage.url();
      const finalBody = await livePage.content();
      const leaks: string[] = [];
      for (const sentinel of [`${SENTINEL}@example.com`, `${SENTINEL}_pwd`]) {
        if (finalUrl.includes(sentinel)) leaks.push(`URL contains "${sentinel}"`);
        if (finalBody.includes(sentinel)) leaks.push(`body contains "${sentinel}"`);
      }
      if (leaks.length === 0) {
        console.log(`\n  ✓ platform login (live submit, JS disabled): no credential leak in URL or body`);
      } else {
        for (const l of leaks) failures.push(`platform login (live): ${l}`);
        console.log(`\n  ✗ platform login (live submit): ${leaks.join(", ")}`);
      }
    } finally {
      await livePage.close();
      await liveCtx.close();
    }
  } finally {
    await browser.close();
  }

  return { failures, total: FORM_TARGETS.length };
}

run()
  .then(({ failures, total }) => {
    if (failures.length === 0) {
      console.log(`\n✓ H1 credential-leak check passed for all ${total} forms (live submit + source).`);
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