// @vitest-environment jsdom
//
// TimeField consumer-seam RED — existing Owner form.
//
// This intentionally renders the current BatchCreateForm (Scheduling-owned,
// not edited here) and asserts the agreed explicit time UI: one named field
// group containing separately labelled hour, minutes and AM/PM controls.
// The native `type="time"` seam cannot satisfy this; the test remains RED
// until Scheduling migrates its pilot to the shared TimeField.

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/actions/programs", () => ({
  createBatchAction: vi.fn(async () => ({ ok: true, batch: {} })),
}));
vi.mock("@/lib/actions/coach-conflicts", () => ({
  checkCoachConflictsAction: vi.fn(async () => ({ conflicts: [] })),
}));

import { BatchCreateForm } from "@/components/batch-create-form";
import type { Program } from "@/db/schema/programs";

afterEach(cleanup);

describe("BatchCreateForm time seam", () => {
  it("exposes an explicit labelled hour/minute/AM-PM group for Start time", () => {
    render(
      <BatchCreateForm
        programs={[{ id: "p1", name: "Squad" } as unknown as Program]}
        coaches={[]}
        locations={[]}
        onCreated={vi.fn()}
        terminology={{ overrides: {}, locale: "en" }}
      />,
    );
    const group = screen.getByRole("group", { name: /start time/i });
    expect(within(group).getByLabelText(/hour/i)).toBeTruthy();
    expect(within(group).getByLabelText(/minute/i)).toBeTruthy();
    expect(within(group).getByLabelText(/am\/pm|period/i)).toBeTruthy();
  });
});
