// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Wave 2, slice 5 — the form wiring for the new fields:
//   * BatchCreateForm sends the chosen facility.
//   * MemberEditForm sends the joined date.
//   * MemberCreateForm offers the optional joined date.
// These were written after the form edits; the service-level tests for
// the same wave were red-first. Mutation proof: deleting `locationId`
// from the create submit or `joinedOn` from the edit submit turns
// these red.

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));
const createBatchAction = vi.hoisted(() =>
  vi.fn(async () => ({
    ok: true as const,
    batch: {
      id: "b1",
      programName: "Squad",
      coachName: null,
      locationName: "Beta",
    },
  })),
);
vi.mock("@/lib/actions/programs", () => ({ createBatchAction }));
vi.mock("@/lib/actions/coach-conflicts", () => ({
  checkCoachConflictsAction: vi.fn(async () => ({ conflicts: [] })),
}));
const updateMemberAction = vi.hoisted(() => vi.fn(async () => ({ ok: true as const })));
vi.mock("@/lib/actions/people", () => ({
  updateMemberAction,
  createMemberAction: vi.fn(),
  searchPersonsAction: vi.fn(async () => []),
}));

import { BatchCreateForm } from "@/components/batch-create-form";
import { MemberEditForm } from "@/components/member-edit-form";
import { MemberCreateForm } from "@/components/member-create-form";
import type { Program } from "@/db/schema/programs";
import type { MemberDetail } from "@/lib/services/people";

const TERMINOLOGY = { overrides: {}, locale: "en" } as const;
const PROGRAM = { id: "p1", name: "Squad" } as unknown as Program;
const LOCATIONS = [
  { id: "11111111-1111-7111-8111-111111111111", name: "Alpha" },
  { id: "22222222-2222-7222-8222-222222222222", name: "Beta" },
];

const MEMBER = {
  memberId: "m1",
  personId: "p1",
  fullName: "Aadhya Sharma",
  phone: null,
  dateOfBirth: "2015-01-01",
  gender: null,
  medicalNotes: null,
  memberCode: "AWS-010",
  status: "active",
  locationId: LOCATIONS[0]!.id,
  locationName: "Alpha",
  isMinor: true,
  createdAt: "2026-09-01T06:00:00.000Z",
  joinedOn: "2026-08-01",
  guardians: [],
  consents: [],
  statusHistory: [],
} as MemberDetail;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("BatchCreateForm facility picker (Wave 2)", () => {
  it("sends the chosen facility with the create", async () => {
    render(
      <BatchCreateForm
        programs={[PROGRAM]}
        coaches={[]}
        locations={LOCATIONS}
        onCreated={vi.fn()}
        terminology={TERMINOLOGY}
      />,
    );

    fireEvent.change(screen.getByTestId("batch-location-picker"), {
      target: { value: LOCATIONS[1]!.id },
    });
    fireEvent.change(screen.getByPlaceholderText("Batch name"), {
      target: { value: "Beta Squad" },
    });
    fireEvent.click(screen.getByRole("button", { name: /add batch/i }));

    await vi.waitFor(() =>
      expect(createBatchAction).toHaveBeenCalledWith(
        expect.objectContaining({ locationId: LOCATIONS[1]!.id, name: "Beta Squad" }),
      ),
    );
  });
});

describe("MemberEditForm joined date (Wave 2)", () => {
  it("sends the joined date with the update", async () => {
    render(<MemberEditForm member={MEMBER} locations={LOCATIONS} />);

    const input = screen.getByTestId("member-joined-on") as HTMLInputElement;
    expect(input.value).toBe("2026-08-01");

    fireEvent.change(input, { target: { value: "2026-07-15" } });
    fireEvent.click(screen.getByRole("button", { name: /save changes/i }));

    await vi.waitFor(() =>
      expect(updateMemberAction).toHaveBeenCalledWith(
        expect.objectContaining({ memberId: "m1", joinedOn: "2026-07-15" }),
      ),
    );
  });
});

describe("MemberCreateForm joined date (Wave 2)", () => {
  it("offers an optional joined date", () => {
    render(<MemberCreateForm locations={LOCATIONS} terminology={TERMINOLOGY} />);
    const input = screen.getByTestId("member-joined-on") as HTMLInputElement;
    expect(input.type).toBe("date");
    expect(input.value).toBe("");
  });
});
