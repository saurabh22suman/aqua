// @vitest-environment jsdom
//
// F03 — Ops "Force on" submits the wrong effective boolean.
//
// The per-tenant entitlement editor renders NO control named "enabled".
// Its Force on / Force off buttons only try to mutate a hidden input
// that does not exist (`form.elements.namedItem("enabled")` is null),
// and the server action reads
//
//     enabled: formData.get("enabled") === "true"
//
// so an absent value becomes false. Force on therefore takes the
// disable path — a broken commercial control.
//
// F04 — the same editor has no expiry field and no preservation value,
// so an edit of a timed override sends no expiry and the backend
// (which treats the upsert as a complete replacement) writes null: the
// deadline disappears.
//
// This file proves the TRANSPORT: what the browser actually submits
// when the operator presses each button. The effect of that submitted
// FormData on the database is proved separately in
// b-04-ops-feature-toggle-effect.test.tsx (same rendered editor, real
// server action, real database).
//
// The server action is replaced by a capture here on purpose: the
// defect lives in the form, and the database effect of the very same
// submitted FormData is asserted in b-04.

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { submitted } = vi.hoisted(() => ({ submitted: [] as FormData[] }));

vi.mock("@/lib/actions/platform-features", () => ({
  upsertTenantFeatureAction: async (_prev: unknown, formData: FormData) => {
    submitted.push(formData);
    // An error state keeps the edit row mounted so the next button can
    // be pressed in the same render. The message is empty, so no alert
    // is rendered.
    return { kind: "error", code: "invalid", message: "" };
  },
}));

import { TenantFeatureToggles } from "@/app/(platform)/ops/tenants/[tenantId]/tenant-feature-toggles";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const FEATURE_KEY = "cafe.pos";
const EXPIRES_AT = new Date("2026-12-31T18:30:00.000Z");

afterEach(() => {
  cleanup();
  submitted.length = 0;
});

function openEditor(feature: {
  key: string;
  source: "plan" | "tenant_override" | "denied";
  expiresAt?: Date;
}): void {
  render(
    <TenantFeatureToggles
      tenantId={TENANT_ID}
      initial={[feature]}
      canWrite={true}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
}

async function press(label: string): Promise<FormData> {
  const before = submitted.length;
  fireEvent.click(screen.getByRole("button", { name: label }));
  await waitFor(() => expect(submitted.length).toBe(before + 1));
  return submitted[before]!;
}

describe("F03 — the Ops entitlement editor submits the operator's intent", () => {
  it("submits the enable intent when the operator presses Force on", async () => {
    openEditor({ key: FEATURE_KEY, source: "plan" });
    const formData = await press("Force on");
    expect(
      formData.get("mode"),
      "Force on must submit the enable intent, not a missing/ambiguous boolean",
    ).toBe("enable");
  });

  it("submits the disable intent when the operator presses Force off", async () => {
    openEditor({ key: FEATURE_KEY, source: "plan" });
    const formData = await press("Force off");
    expect(formData.get("mode")).toBe("disable");
  });

  it("keeps Force on and Force off distinguishable in the submitted form", async () => {
    openEditor({ key: FEATURE_KEY, source: "plan" });
    const forceOn = await press("Force on");
    const forceOff = await press("Force off");
    expect(
      forceOn.get("mode"),
      "the two buttons must not submit the same operation",
    ).not.toBe(forceOff.get("mode"));
  });

  it("submits the clear intent when the operator presses Reset to plan", async () => {
    openEditor({ key: FEATURE_KEY, source: "tenant_override" });
    const formData = await press("Reset to plan");
    expect(formData.get("mode")).toBe("clear");
  });

  it("submits the tenant and the feature key (unchanged behaviour)", async () => {
    openEditor({ key: FEATURE_KEY, source: "plan" });
    const formData = await press("Force on");
    expect(formData.get("tenantId")).toBe(TENANT_ID);
    expect(formData.get("featureKey")).toBe(FEATURE_KEY);
  });
});

describe("F04 — the Ops entitlement editor submits the deadline it is editing", () => {
  it("submits the current deadline so an edit cannot silently drop it", async () => {
    openEditor({
      key: FEATURE_KEY,
      source: "tenant_override",
      expiresAt: EXPIRES_AT,
    });
    const formData = await press("Force on");
    expect(
      formData.get("expiresAt"),
      "the edit must carry the deadline it is preserving",
    ).toBe(EXPIRES_AT.toISOString());
  });

  it("submits the deadline of a timed denial too", async () => {
    openEditor({
      key: FEATURE_KEY,
      source: "denied",
      expiresAt: EXPIRES_AT,
    });
    const formData = await press("Force off");
    expect(formData.get("expiresAt")).toBe(EXPIRES_AT.toISOString());
  });

  it("submits no deadline for an override that has none", async () => {
    openEditor({ key: FEATURE_KEY, source: "plan" });
    const formData = await press("Force on");
    expect(formData.get("expiresAt")).toBeNull();
  });
});

describe("viewer denial (unchanged behaviour)", () => {
  it("shows a read-only operator no edit control at all", () => {
    render(
      <TenantFeatureToggles
        tenantId={TENANT_ID}
        initial={[{ key: FEATURE_KEY, source: "plan" }]}
        canWrite={false}
      />,
    );
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Force on" }),
      "a viewer must never see a toggle that would fail on submit",
    ).toBeNull();
  });
});
