// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/membership-plans", () => ({ activatePlanFromShapeAction: vi.fn(), archivePlanAction: vi.fn(), createPlanAction: vi.fn(), updatePlanAction: vi.fn() }));
import { PlanManager } from "@/components/plan-manager";
afterEach(cleanup);
it("summarizes an empty catalogue while retaining site names and a reachable creation disclosure", () => {
  render(<PlanManager plans={[]} templates={[]} activities={[]} locations={[{id:"a",name:"North"},{id:"b",name:"South"}]} />);
  expect(screen.getByText(/no plans yet/i)).toBeTruthy();
  expect(screen.getByText(/Facilities: North, South/)).toBeTruthy();
  expect(screen.getByText("Add plan", {selector:"summary"}).closest("details")?.open).toBe(false);
  expect(screen.getByText("Use a preset template").closest("details")?.open).toBe(false);
  const toggle = screen.getByText("Add plan", {selector:"summary"});
  fireEvent.click(toggle);
  fireEvent.change(screen.getByLabelText("Name"), {target:{value:"Draft plan"}});
  fireEvent.click(toggle);
  fireEvent.click(toggle);
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Draft plan");
});
