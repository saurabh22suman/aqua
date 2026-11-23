// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { Program } from "@/db/schema/programs";
const actions = vi.hoisted(() => ({ create: vi.fn(async () => { throw new Error("network"); }), cancel: vi.fn(async () => { throw new Error("network"); }) }));
vi.mock("@/lib/actions/programs", () => ({ createBatchAction: actions.create }));
vi.mock("@/lib/actions/coach-conflicts", () => ({ checkCoachConflictsAction: async () => ({ conflicts: [] }) }));
vi.mock("@/lib/actions/session-lifecycle", () => ({ cancelSessionAction: actions.cancel, rescheduleSessionAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
import { BatchCreateForm } from "@/components/batch-create-form";
import { SessionLifecycleControl } from "@/components/session-lifecycle-control";
afterEach(cleanup);
it("retains batch draft and announces uncertain save after transport rejection", async () => {
  render(<BatchCreateForm programs={[{ id: "p", name: "Swimming" } as Program]} coaches={[]} locations={[]} onCreated={vi.fn()} terminology={{ overrides: {}, locale: "en" }} />);
  fireEvent.change(screen.getByLabelText("Batch name"), { target: { value: "Morning" } });
  fireEvent.click(screen.getByRole("button", { name: "Add batch" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/check.*before retry/i);
  expect(screen.getByLabelText("Batch name")).toHaveProperty("value", "Morning");
});
it("states which operation is pending while the batch request is unresolved", async () => {
  actions.create.mockImplementationOnce(() => new Promise(() => {}));
  render(<BatchCreateForm programs={[{ id: "p", name: "Swimming" } as Program]} coaches={[]} locations={[]} onCreated={vi.fn()} terminology={{ overrides: {}, locale: "en" }} />);
  fireEvent.change(screen.getByLabelText("Batch name"), { target: { value: "Morning" } });
  fireEvent.click(screen.getByRole("button", { name: "Add batch" }));
  expect(await screen.findByRole("button", { name: "Adding batch…" })).toHaveProperty("disabled", true);
});
it("announces an uncertain cancellation without closing its confirmation", async () => {
  render(<SessionLifecycleControl sessionId="s" sessionDate="2030-01-01" startWall="07:00" endWall="08:00" status="scheduled" onChanged={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Cancel session" }));
  fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
  expect((await screen.findByRole("alert")).textContent).toMatch(/check.*before retry/i);
  expect(screen.getByRole("button", { name: "Keep" })).toBeTruthy();
});
