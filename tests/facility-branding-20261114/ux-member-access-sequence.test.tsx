// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/actions/member-link-binding", () => ({ confirmLinkBindingAction: vi.fn(), issueMemberActivationTokenAction: vi.fn(), withdrawLinkBindingAction: vi.fn() }));
import { MemberAccessPanel } from "@/components/member-detail/member-access-panel";
import type { MemberAccessRead } from "@/lib/services/member-link-readmodel";
afterEach(cleanup);
it("explains setup, pairing confirmation and invitation without claiming accounts cannot be created", () => {
  const read = { memberName: "Member", memberCode: "M1", facilityName: "Main", links: [], guardianChoices: [] } as unknown as MemberAccessRead;
  render(<MemberAccessPanel read={read} failed={false} />);
  expect(screen.getByText(/set up sign-in.*confirm.*invitation/i)).toBeTruthy();
  expect(screen.queryByText(/does not create accounts/i)).toBeNull();
});
