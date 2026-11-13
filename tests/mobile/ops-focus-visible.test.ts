import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// PR1b (ops console improvements) — every form control under
// app/(platform)/ops used `focus:border-[var(--accent)] focus:outline-none`,
// which strips the browser's default outline and replaces it with a
// 1px border-color change only — a weak keyboard-focus signal per
// DESIGN.md §1.2 ("--accent" is explicitly reserved for, among other
// things, focus rings). The fix keeps the border change but adds a
// real focus-visible outline, scoped so it only shows for keyboard
// focus, not every mouse click.
//
// The focus-ring colour lives in a dedicated `--focus-ring` token
// (DESIGN.md §1.2) measured at 5.09:1 on paper. The source test
// asserts the new token; tests/a11y/ops-focus-rendered.test.ts is
// the render-side guard that catches the Tailwind v4 outline-none
// trap the source test cannot.
//
// Mutation proof: reverting any listed file's outline classes back to
// bare `focus:outline-none` turns this test red; replacing
// `focus-visible:outline-solid focus-visible:outline-2` with
// `focus-visible:outline focus-visible:outline-2` (the broken
// combination the audit caught) ALSO turns the render test red
// without breaking this one — see tests/a11y.

const ROOT = process.cwd();

const MUST_HAVE_FOCUS_VISIBLE_OUTLINE = [
  "app/(platform)/ops/verify/verify-form.tsx",
  "app/(platform)/ops/features/feature-catalogue.tsx",
  "app/(platform)/ops/leads/new/new-lead-form.tsx",
  "app/(platform)/ops/leads/[leadId]/lead-actions.tsx",
  "app/(platform)/ops/login/login-form.tsx",
  "app/(platform)/ops/whatsapp/whatsapp-mock.tsx",
  "app/(platform)/ops/presets/[key]/preset-detail-form.tsx",
  "app/(platform)/ops/tenants/page.tsx",
  "app/(platform)/ops/tenants/[tenantId]/status-transitions.tsx",
  "app/(platform)/ops/tenants/[tenantId]/invite-owner-form.tsx",
  "app/(platform)/ops/tenants/[tenantId]/configuration/change-requests.tsx",
  "app/(platform)/ops/tenants/[tenantId]/configuration/tenant-selector.tsx",
  "app/(platform)/ops/tenants/[tenantId]/tax/tax-rates.tsx",
  "app/(platform)/ops/tenants/new/new-tenant-form.tsx",
];

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("ops form controls have a visible keyboard focus style", () => {
  it("provides the shared visible focus fallback without audited source overrides", () => {
    // Shared base styling replaces the old duplicated per-file classes.
    // The real browser companion still verifies the actual computed ring.
    const css = read("app/globals.css");
    expect(css).toMatch(/:where\(a, button, input, select, textarea, \[role="button"\], \[tabindex\]\):focus-visible\s*\{\s*outline:\s*2px solid var\(--focus-ring\)/);
    expect(css).toMatch(/outline-offset:\s*2px/);
    const overrides = MUST_HAVE_FOCUS_VISIBLE_OUTLINE.filter((rel) =>
      /(?:outline-none|outline-hidden|outline\s*:\s*(?:none|0)\b)/.test(read(rel)),
    );
    expect(overrides, `audited source removes the focus outline:\n${overrides.join("\n")}`).toEqual([]);
  });

  it("no bare focus:outline-none remains under app/(platform)/ops", () => {
    const hits = MUST_HAVE_FOCUS_VISIBLE_OUTLINE.filter((rel) =>
      read(rel).includes("focus:outline-none"),
    );
    expect(hits, `still strips outline without a focus-visible replacement:\n${hits.join("\n")}`).toEqual([]);
  });
});
