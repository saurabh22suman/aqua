// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// People mobile — intended RED before wiring the transferred DateField v2
// into the owned create/edit callers. The DOB is mandatory, so the control
// must expose the label association, required state and persistent format
// description. Joined-on remains optional.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/actions/people", () => ({
  createMemberAction: vi.fn(),
  updateMemberAction: vi.fn(),
  searchPersonsAction: vi.fn(async () => []),
}));

import { MemberCreateForm } from "@/components/member-create-form";
import { MemberEditForm } from "@/components/member-edit-form";
import type { MemberDetail } from "@/lib/services/people";

afterEach(cleanup);

const MEMBER = {
  memberId: "m1",
  fullName: "Aaradhya Iyer",
  phone: null,
  dateOfBirth: "2016-09-23",
  joinedOn: "2026-10-10",
  gender: "female",
  locationId: "loc-1",
  medicalNotes: null,
  memberCode: "AAC-001",
  locationName: "Worli Main",
  isMinor: true,
  status: "active",
  guardians: [],
  consents: [],
  statusHistory: [],
} as unknown as MemberDetail;

describe("member create DOB association", () => {
  it("announces the mandatory date and its persistent format guidance", () => {
    render(
      <MemberCreateForm
        locations={[{ id: "loc-1", name: "Worli Main" }]}
        terminology={{ overrides: {}, locale: "en" }}
      />,
    );

    const dob = document.querySelector('[data-testid="member-dob"]') as HTMLInputElement;
    expect(dob).toBeTruthy();
    expect(dob.required).toBe(true);
    expect(dob.getAttribute("aria-required")).toBe("true");
    expect(dob.getAttribute("aria-describedby")).toContain("member-dob-format");

    const joined = document.querySelector(
      '[data-testid="member-joined-on"]',
    ) as HTMLInputElement;
    expect(joined.required).toBe(false);
  });
});

describe("member edit DOB association", () => {
  it("announces the mandatory date while leaving joined-on optional", () => {
    render(<MemberEditForm member={MEMBER} locations={[{ id: "loc-1", name: "Worli Main" }]} />);

    const dob = document.querySelector('[data-testid="member-dob"]') as HTMLInputElement;
    // The edit caller has its own id until wired; support either while RED.
    const editDob = (dob ??
      document.querySelector("#edit-dob")) as HTMLInputElement | null;
    expect(editDob, "DOB control must exist").toBeTruthy();
    expect(editDob!.required).toBe(true);
    expect(editDob!.getAttribute("aria-required")).toBe("true");

    const joined = document.querySelector(
      '[data-testid="member-joined-on"]',
    ) as HTMLInputElement;
    expect(joined.required).toBe(false);
  });
});
