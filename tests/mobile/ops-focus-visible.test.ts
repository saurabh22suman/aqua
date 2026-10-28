import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// PR1b (ops console improvements) — every form control under
// app/(platform)/ops used `focus:border-[var(--accent)] focus:outline-none`,
// which strips the browser's default outline and replaces it with a
// 1px border-color change only — a weak keyboard-focus signal per
// DESIGN.md §1.2 ("--accent" is explicitly reserved for, among other
// things, focus rings").
//
// Ops redesign (28 October 2026) — the guard now accepts EITHER
// evidence of a keyboard focus style:
//
//   (a) the file draws the ring itself — the literal
//       `focus-visible:outline-[var(--focus-ring)]`; or
//   (b) the file CONSUMES a shared control (Input, Select, Textarea,
//       Button, Field), whose focus ring is the theme's
//       `--focus-ring` — drawn either by the control's own
//       focus-visible utility or by the global
//       `:where(a, button, input, select, textarea, …):focus-visible`
//       rule in app/globals.css.
//
// (b) exists because the console no longer keeps its own control
// style system: the Ops routes now use the SHARED controls, exactly
// like the tenant workspace. Keeping a hand-written class string in
// every route purely to satisfy this grep would be a second style
// system — the thing the redesign removed.
//
// THE RENDERED PROOF IS NOT HERE. A source string cannot tell whether
// an outline actually draws (Tailwind v4's `outline-none` sets
// `--tw-outline-style: none`, which resolves to none at paint time
// even when the source says `outline-2`). The rendered contract is
// proven in real Chrome, on every routed Ops form, in both approved
// presets:
//
//   e2e/ops-redesign/ops-focus-routed.ts
//
// and, for /ops/login, by tests/a11y/ops-focus-rendered.test.ts.
//
// The rule that must NOT be relaxed: a bare `focus:outline-none` with
// no focus-visible replacement is still a defect, wherever it appears.

const ROOT = process.cwd();

const OPS_FORM_FILES = [
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

/** The shared controls that carry the theme's focus ring. */
const SHARED_CONTROL_IMPORTS = [
  "@/components/ui/Input",
  "@/components/ui/Select",
  "@/components/ui/Textarea",
  "@/components/ui/Button",
  "@/components/ui/Field",
];

const FOCUS_RING_LITERAL = "focus-visible:outline-[var(--focus-ring)]";

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

describe("ops form controls have a visible keyboard focus style", () => {
  it("every audited file either draws the focus ring or consumes a shared control", () => {
    const missing = OPS_FORM_FILES.filter((rel) => {
      const source = read(rel);
      if (source.includes(FOCUS_RING_LITERAL)) return false;
      return !SHARED_CONTROL_IMPORTS.some((entry) => source.includes(entry));
    });
    expect(
      missing,
      `no focus evidence — neither the focus ring literal nor a shared control:\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("no bare focus:outline-none remains under app/(platform)/ops", () => {
    const hits = OPS_FORM_FILES.filter((rel) =>
      read(rel).includes("focus:outline-none"),
    );
    expect(
      hits,
      `still strips outline without a focus-visible replacement:\n${hits.join("\n")}`,
    ).toEqual([]);
  });

  it("no Ops route keeps a second, hand-rolled control style system", () => {
    // The console reuses the shared controls; it must not carry its
    // own copies of the control metrics (a second style system is how
    // the two drift apart).
    const offenders = OPS_FORM_FILES.filter((rel) => {
      const source = read(rel);
      const copiesTheMetrics =
        source.includes("min-h-12") || source.includes("min-h-11");
      const usesShared = SHARED_CONTROL_IMPORTS.some((entry) =>
        source.includes(entry),
      );
      return copiesTheMetrics && !usesShared;
    });
    expect(
      offenders,
      `hand-rolled control metrics without a shared control:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
