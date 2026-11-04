// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TerminologyState } from "@/lib/terminology/keys";
import type { StaffRow } from "@/lib/services/staff";

// Owner OpenPen mobile slice (29 October 2026).
//
// DateField v2 forwards the Field contract: the label association, the
// format/error description and the required/optional semantics. A
// mandatory date must expose `required`, while an optional date must
// stay optional. This pins the owned staff, enquiry, leave and roster
// callers.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

vi.mock("@/lib/actions/staff", () => ({
  createStaffAction: async () => ({ ok: true }),
}));
vi.mock("@/lib/actions/leave", () => ({
  requestLeaveAction: async () => ({ ok: true }),
}));
vi.mock("@/lib/actions/enquiries", () => ({
  searchGuardiansAction: async () => [],
}));

import { StaffCreateForm } from "@/components/staff-create-form";
import { LeaveRequestForm } from "@/components/leave-request-form";
import { EnquiryNewMemberFields } from "@/components/enquiry-new-member-fields";
import { AddShiftForm } from "@/components/roster/add-shift-form";

afterEach(cleanup);

const TERMS = { locale: "en", overrides: {} } as TerminologyState;

describe("owned DateField callers", () => {
  it("keeps the optional staff employment date optional", () => {
    render(<StaffCreateForm terminology={TERMS} />);

    const date = screen.getByRole("textbox", {
      name: /Employed on \(optional\)/i,
    });
    expect(date.getAttribute("required")).toBeNull();
    expect(date.getAttribute("aria-required")).toBeNull();
    expect(date.getAttribute("aria-describedby")).toBeTruthy();
  });

  it("marks the mandatory enquiry date of birth required", () => {
    render(
      <EnquiryNewMemberFields
        locations={[{ id: "loc-1", name: "Worli Main" }]}
        onChange={() => undefined}
        onValidityChange={() => undefined}
        terminology={TERMS}
      />,
    );

    const date = screen.getByRole("textbox", { name: /^Date of birth/ });
    expect(date.getAttribute("aria-required")).toBe("true");
    expect(date.getAttribute("aria-describedby")).toBeTruthy();
  });

  it("marks both leave dates required", () => {
    render(
      <LeaveRequestForm
        types={[
          {
            id: "type-1",
            name: "Casual leave",
            annualQuota: 12,
            isPaid: true,
          },
        ]}
      />,
    );

    for (const name of ["From", "To"]) {
      const date = screen.getByRole("textbox", { name: new RegExp(`^${name}`) });
      expect(date.getAttribute("aria-required")).toBe("true");
    }
  });

  it("marks the roster shift date required", () => {
    render(
      <AddShiftForm
        weekStart="2026-10-26"
        templates={[]}
        staff={[
          {
            id: "staff-1" as StaffRow["id"],
            personId: "person-1" as StaffRow["personId"],
            fullName: "Aanya Rao",
            staffType: "coach",
            userId: null,
            employedOn: null,
          },
        ]}
        locations={[{ id: "loc-1", name: "Worli Main" }]}
        initialLocationId="loc-1"
        pending={false}
        onAdd={() => undefined}
      />,
    );

    const date = screen.getByRole("textbox", { name: /^Date/ });
    expect(date.getAttribute("aria-required")).toBe("true");
    expect(date.getAttribute("aria-describedby")).toBeTruthy();
  });
});
