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
// Mutation proof: reverting any listed file's outline classes back to
// bare `focus:outline-none` turns this test red.

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
  "app/(platform)/ops/tenants/[tenantId]/tax/tax-rates.tsx",
  "app/(platform)/ops/tenants/new/new-tenant-form.tsx",
];

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("ops form controls have a visible keyboard focus style", () => {
  it("every audited file pairs outline-none with a focus-visible accent outline", () => {
    const missing = MUST_HAVE_FOCUS_VISIBLE_OUTLINE.filter(
      (rel) => !read(rel).includes("focus-visible:outline-[var(--accent)]"),
    );
    expect(missing, `no focus-visible outline:\n${missing.join("\n")}`).toEqual([]);
  });

  it("no bare focus:outline-none remains under app/(platform)/ops", () => {
    const hits = MUST_HAVE_FOCUS_VISIBLE_OUTLINE.filter((rel) =>
      read(rel).includes("focus:outline-none"),
    );
    expect(hits, `still strips outline without a focus-visible replacement:\n${hits.join("\n")}`).toEqual([]);
  });
});
