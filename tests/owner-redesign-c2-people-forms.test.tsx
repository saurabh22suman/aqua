// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Owner redesign · People lane (C2) — the member forms.
//
// RED target (branch feat/owner-redesign-people-c2, base d1425e7):
//
//   1. The member forms rendered hand-rolled controls whose labels
//      were a <span> inside a wrapping <label>. The text inputs and
//      selects carried no id at all, so there was no label↔control
//      association a pointer or an assistive technology could address,
//      and the controls restated the shared metrics by hand.
//   2. The guardian fields carried a page-local `bg-deck` surface that
//      overrode the shared neutral entry-field tint, so one form mixed
//      two control surfaces.
//
// The guard tests in this file protect the protections that must not
// move: the minor/guardian requirement and the processing-consent
// requirement.

vi.mock("@/lib/actions/people", () => ({
  createMemberAction: vi.fn(async () => ({ ok: false, error: "refused" })),
  updateMemberAction: vi.fn(async () => ({ ok: false, error: "refused" })),
  searchPersonsAction: vi.fn(async () => []),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { MemberCreateForm } from "@/components/member-create-form";
import { MemberEditForm } from "@/components/member-edit-form";
import { StaffCreateForm } from "@/components/staff-create-form";
import { StaffInviteForm } from "@/components/staff-invite-form";

const LOCATIONS = [{ id: "l1", name: "Main" }];
const TERMINOLOGY = { locale: "en", overrides: {} } as never;
const MEMBER = {
  memberId: "m1",
  fullName: "Aadhya Sharma",
  phone: "+919812340010",
  dateOfBirth: "2014-01-01",
  joinedOn: "2026-08-01",
  gender: "female",
  locationId: "l1",
  medicalNotes: null,
} as never;

function unlabelledControls() {
  return Array.from(
    document.querySelectorAll<HTMLElement>("input, select, textarea"),
  ).filter((control) => {
    const id = control.getAttribute("id");
    if (id && document.querySelector(`label[for="${id}"]`)) return false;
    return !control.closest("label");
  });
}

/** The text, select and date controls the shared `Field` primitive
 *  renders: each one carries an id a label points at. */
function unlabelledTextControls() {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      "input:not([type=checkbox]), select, textarea",
    ),
  ).filter((control) => {
    const id = control.getAttribute("id");
    return !id || !document.querySelector(`label[for="${id}"]`);
  });
}

beforeAll(() => {
  // jsdom has no layout engine, so scrollIntoView is not implemented.
  // The form calls it to bring a failed field into view.
  Element.prototype.scrollIntoView = function scrollIntoView() {};
});

afterEach(cleanup);

describe("member forms (C2)", () => {
  it("associates every text and select field in the new-member form by id", () => {
    render(<MemberCreateForm locations={LOCATIONS} terminology={TERMINOLOGY} />);

    const unlabelled = unlabelledTextControls();
    expect(
      unlabelled.map((control) => control.outerHTML.slice(0, 120)),
    ).toEqual([]);
  });

  it("associates every text and select field in the edit form by id", () => {
    render(<MemberEditForm member={MEMBER} locations={LOCATIONS} />);

    const unlabelled = unlabelledTextControls();
    expect(
      unlabelled.map((control) => control.outerHTML.slice(0, 120)),
    ).toEqual([]);
  });

  it("leaves no control without a label in either form", () => {
    const { unmount } = render(
      <MemberCreateForm locations={LOCATIONS} terminology={TERMINOLOGY} />,
    );
    expect(unlabelledControls().map((c) => c.outerHTML.slice(0, 120))).toEqual([]);
    unmount();

    render(<MemberEditForm member={MEMBER} locations={LOCATIONS} />);
    expect(unlabelledControls().map((c) => c.outerHTML.slice(0, 120))).toEqual([]);
  });

  it("associates every text field in the staff record form by id", () => {
    render(<StaffCreateForm terminology={TERMINOLOGY} />);

    expect(
      unlabelledTextControls().map((control) => control.outerHTML.slice(0, 120)),
    ).toEqual([]);
  });

  it("associates every text field in the staff invite form by id", () => {
    render(<StaffInviteForm locations={LOCATIONS} />);

    expect(
      unlabelledTextControls().map((control) => control.outerHTML.slice(0, 120)),
    ).toEqual([]);
  });

  it("keeps the processing-consent requirement", () => {
    render(<MemberCreateForm locations={LOCATIONS} terminology={TERMINOLOGY} />);

    fireEvent.change(screen.getByTestId("member-full-name"), {
      target: { value: "Aadhya Sharma" },
    });
    fireEvent.change(screen.getByTestId("member-dob"), {
      target: { value: "01/01/1990" },
    });
    fireEvent.click(screen.getByTestId("submit-member"));

    expect(screen.getByRole("alert").textContent).toMatch(/consent/i);
  });

  it("keeps the guardian requirement for a minor", () => {
    render(<MemberCreateForm locations={LOCATIONS} terminology={TERMINOLOGY} />);

    fireEvent.change(screen.getByTestId("member-full-name"), {
      target: { value: "Aadhya Sharma" },
    });
    fireEvent.change(screen.getByTestId("member-dob"), {
      target: { value: "01/01/2015" },
    });
    fireEvent.click(screen.getByTestId("consent-checkbox"));
    fireEvent.click(screen.getByTestId("submit-member"));

    expect(screen.getByRole("alert").textContent).toMatch(/guardian/i);
  });
});
