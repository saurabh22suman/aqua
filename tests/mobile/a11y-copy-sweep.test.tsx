// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// PR3-C10 — the accessibility/copy sweep's mechanical pins:
// no sub-11px text, 44px floor on the small row actions, and a human
// accessible name on the inline edit affordance.

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/people", () => ({
  updateMemberAction: vi.fn(async () => ({ kind: "ok" })),
}));

import { InlineEditField } from "@/components/member-detail/inline-edit-field";

const ROOT = process.cwd();

function source(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

afterEach(cleanup);

describe("type floor (PR3-C10)", () => {
  it("no sub-11px text classes remain in the swept files", () => {
    for (const path of [
      "components/member-detail/member-attendance-grid.tsx",
      "components/owner-schedule-grid.tsx",
      "components/member-subscription-panel.tsx",
      "components/member-detail/member-invoices-panel.tsx",
    ]) {
      const src = source(path);
      expect(src.includes("text-[9px]"), path).toBe(false);
      expect(src.includes("text-[10px]"), path).toBe(false);
    }
  });
});

describe("tap targets (PR3-C10)", () => {
  it("the subscription and invoice row actions carry the 44px floor", () => {
    for (const path of [
      "components/member-subscription-panel.tsx",
      "components/member-detail/member-invoices-panel.tsx",
    ]) {
      const src = source(path);
      expect(src.includes("min-h-11"), path).toBe(true);
      // The old 28px action class (px-3 py-1) is gone.
      expect(
        /rounded-pill border border-line px-3 py-1 text-\[12px\]/.test(src),
        path,
      ).toBe(false);
    }
  });
});

describe("inline edit accessible name (PR3-C10)", () => {
  it("reads as 'Edit name', not 'Edit fullName'", () => {
    render(
      <InlineEditField
        value="Audit Child"
        field="fullName"
        memberId="11111111-1111-7111-8111-111111111111"
        type="text"
        snapshot={{
          fullName: "Audit Child",
          dateOfBirth: "2015-01-01",
          locationId: "loc",
          phone: null,
          gender: null,
          medicalNotes: null,
        }}
      />,
    );
    expect(screen.getByRole("button", { name: "Edit name" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit fullName" })).toBeNull();
  });
});
