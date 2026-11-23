// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({useRouter: () => ({push:vi.fn(),refresh:vi.fn()})}));
vi.mock("@/lib/actions/people", () => ({createMemberAction:vi.fn(),searchPersonsAction:vi.fn().mockResolvedValue([])}));
import { createMemberAction, searchPersonsAction } from "@/lib/actions/people";
import { MemberCreateForm } from "@/components/member-create-form";

beforeEach(() => { HTMLElement.prototype.scrollIntoView = vi.fn(); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function form(minor = false) {
  render(<MemberCreateForm locations={[{id:"l1",name:"Main"}]} terminology={{locale:"en",overrides:{}}} />);
  fireEvent.change(screen.getByTestId("member-full-name"),{target:{value:"Synthetic Member"}});
  fireEvent.change(screen.getByTestId("member-dob"),{target:{value:minor ? "01/01/2020" : "01/01/1990"}});
  fireEvent.click(screen.getByTestId("consent-checkbox"));
  if (minor) {
    fireEvent.change(screen.getByTestId("guardian-new-name"),{target:{value:"Synthetic Guardian"}});
    fireEvent.change(screen.getByTestId("guardian-relationship"),{target:{value:"Parent"}});
  }
}
it.each(["abcdefghijk", "+123456789012345678901", "+01234567890", "+1234567890123456"])("rejects invalid supplied member phone %s inline without writing or changing consent", (value) => {
  form();
  const phone = screen.getByLabelText("Phone (optional)");
  fireEvent.change(phone,{target:{value}});
  fireEvent.click(screen.getByTestId("submit-member"));
  expect(screen.getByText(/enter a valid phone number/i)).toBeTruthy();
  expect(document.activeElement).toBe(phone);
  expect((screen.getByTestId("consent-checkbox") as HTMLInputElement).checked).toBe(true);
  expect(createMemberAction).not.toHaveBeenCalled();
});
it.each(["abcdefghijk", "+123456789012345678901", "+01234567890", "+1234567890123456"])("rejects invalid new guardian phone %s without writing or changing consent", (value) => {
  form(true);
  const phone = screen.getByLabelText("Guardian phone (optional)");
  fireEvent.change(phone,{target:{value}});
  fireEvent.click(screen.getByTestId("submit-member"));
  expect(screen.getByText(/enter a valid phone number/i)).toBeTruthy();
  expect(document.activeElement).toBe(phone);
  expect((screen.getByTestId("consent-checkbox") as HTMLInputElement).checked).toBe(true);
  expect(createMemberAction).not.toHaveBeenCalled();
});
it.each(["", "+44 20 7946 0958"])("allows an optional blank or international number: %s", async (value) => {
  vi.mocked(createMemberAction).mockResolvedValueOnce({ok:false,error:"Synthetic refusal"});
  form();
  fireEvent.change(screen.getByLabelText("Phone (optional)"),{target:{value}});
  fireEvent.click(screen.getByTestId("submit-member"));
  await waitFor(() => expect(createMemberAction).toHaveBeenCalledOnce());
  expect(vi.mocked(createMemberAction).mock.calls[0]![0].phone).toBe(value || undefined);
});
it("ignores stale new-guardian phone after selecting an existing guardian", async () => {
  vi.mocked(createMemberAction).mockResolvedValueOnce({ok:false,error:"Synthetic refusal"});
  vi.mocked(searchPersonsAction).mockResolvedValueOnce([{personId:"g1",fullName:"Existing Guardian",phone:null,isMinor:false}]);
  form(true);
  fireEvent.change(screen.getByLabelText("Guardian phone (optional)"),{target:{value:"abcdefghijk"}});
  fireEvent.change(screen.getByTestId("guardian-search"),{target:{value:"Existing"}});
  fireEvent.click(await screen.findByRole("button",{name:"Existing Guardian"}));
  fireEvent.click(screen.getByTestId("submit-member"));
  await waitFor(() => expect(createMemberAction).toHaveBeenCalledOnce());
  expect(vi.mocked(createMemberAction).mock.calls[0]![0].guardian).toMatchObject({existingPersonId:"g1"});
});
it("does not claim a permission error when the save outcome is unknown", async () => {
  vi.mocked(createMemberAction).mockRejectedValueOnce(new Error("connection lost"));
  form();
  fireEvent.click(screen.getByTestId("submit-member"));
  expect(await screen.findByText(/check the member list before trying again/i)).toBeTruthy();
  expect(screen.queryByText(/may not have permission/i)).toBeNull();
});
