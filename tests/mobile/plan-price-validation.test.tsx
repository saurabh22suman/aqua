// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner-UI review P1 (2026-10-13) — an invalid plan price is rejected
// visibly and before any write. A rejected price must not ride along
// with a name change as a false "Saved.", and the custom form must not
// coerce a malformed price to ₹0.

const createPlanAction = vi.hoisted(() => vi.fn());
const updatePlanAction = vi.hoisted(() => vi.fn());
const archivePlanAction = vi.hoisted(() => vi.fn());
const activatePlanFromShapeAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/membership-plans", () => ({
  createPlanAction,
  updatePlanAction,
  archivePlanAction,
  activatePlanFromShapeAction,
}));
const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

import { PlanManager } from "@/components/plan-manager";
import type { PlanRow } from "@/lib/services/membership-plans";

const LOC = { id: "11111111-1111-4111-8111-111111111111", name: "Worli" };

const PLAN: PlanRow = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Monthly Swim",
  kind: "duration",
  durationDays: 30,
  sessions: null,
  amountPaise: 250_000,
  locationId: LOC.id,
  locationName: LOC.name,
  activityId: null,
  activityName: null,
  isActive: true,
  sourceShapeId: null,
} as PlanRow;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PlanManager price validation (P1)", () => {
  it("rejects a malformed edit price and never reports success", async () => {
    render(
      <PlanManager
        templates={[]}
        plans={[PLAN]}
        locations={[LOC]}
        activities={[]}
      />,
    );

    fireEvent.click(screen.getByText("Edit"));
    const priceInput = screen.getByDisplayValue("2500.00");
    fireEvent.change(priceInput, { target: { value: "12.345" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(screen.getByText(/enter a price in rupees/i)).toBeTruthy(),
    );
    expect(updatePlanAction).not.toHaveBeenCalled();
    expect(screen.queryByText("Saved.")).toBeNull();
  });

  it("rejects a negative or zero price on a custom plan without writing", async () => {
    render(
      <PlanManager
        templates={[]}
        plans={[]}
        locations={[LOC]}
        activities={[]}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("2500"), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add plan/i }));

    await waitFor(() =>
      expect(screen.getByText(/price must be more than/i)).toBeTruthy(),
    );
    expect(createPlanAction).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText("2500"), {
      target: { value: "-50" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add plan/i }));
    await waitFor(() =>
      expect(screen.getByText(/enter a price in rupees/i)).toBeTruthy(),
    );
    expect(createPlanAction).not.toHaveBeenCalled();
  });

  it("saves valid name and price together", async () => {
    updatePlanAction.mockResolvedValue({ ok: true, id: PLAN.id });
    render(
      <PlanManager
        templates={[]}
        plans={[PLAN]}
        locations={[LOC]}
        activities={[]}
      />,
    );

    fireEvent.click(screen.getByText("Edit"));
    const nameInput = screen.getByDisplayValue("Monthly Swim");
    fireEvent.change(nameInput, { target: { value: "Monthly Swim Pro" } });
    fireEvent.change(screen.getByDisplayValue("2500.00"), {
      target: { value: "3000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updatePlanAction).toHaveBeenCalledWith({
        id: PLAN.id,
        name: "Monthly Swim Pro",
        amountPaise: 300_000,
      }),
    );
  });
});
