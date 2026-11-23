// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/member-link-binding", () => ({ confirmLinkBindingAction: vi.fn(), issueMemberActivationTokenAction: vi.fn(), withdrawLinkBindingAction: vi.fn() }));
vi.mock("@/lib/actions/guardian-authorization", () => ({ withdrawGuardianAuthorizationAction: vi.fn() }));
import { MemberAccessPanel } from "@/components/member-detail/member-access-panel";
import type { MemberAccessRead } from "@/lib/services/member-link-readmodel";
afterEach(cleanup);
it("explains setup, pairing confirmation and invitation without claiming accounts cannot be created", () => {
  const read = { memberName: "Member", memberCode: "M1", facilityName: "Main", links: [], guardianChoices: [] } as unknown as MemberAccessRead;
  render(<MemberAccessPanel read={read} failed={false} />);
  expect(screen.getByText(/set up sign-in.*confirm.*invitation/i)).toBeTruthy();
  expect(screen.queryByText(/does not create accounts/i)).toBeNull();
});

it("shows sign-in status before disclosing controls to end family authorization", () => {
  const read: MemberAccessRead = {
    memberId: "m1",
    memberName: "Member",
    memberCode: "M1",
    facilityName: "Main",
    links: [],
    guardianChoices: [{ guardianshipId: "g1", personName: "Guardian", relationship: "parent", clubPhone: null }],
  };
  render(<MemberAccessPanel read={read} failed={false} />);
  const status = screen.getByText("No sign-in link yet");
  const authorizations = screen.getByText("Family authorizations");
  expect(status.compareDocumentPosition(authorizations) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(authorizations.closest("details")?.open).toBe(false);
  fireEvent.click(authorizations);
  expect(authorizations.closest("details")?.open).toBe(true);
  expect((screen.getByRole("button", { name: "End guardian authorization" }) as HTMLButtonElement).disabled).toBe(true);
});
