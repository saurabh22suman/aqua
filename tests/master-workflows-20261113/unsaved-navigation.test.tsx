// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const push = vi.fn();
vi.mock("next/navigation", () => ({useRouter:() => ({push,refresh:vi.fn()})}));
vi.mock("@/lib/actions/people", () => ({createMemberAction:vi.fn(),searchPersonsAction:vi.fn().mockResolvedValue([])}));
import { MemberCreateForm } from "@/components/member-create-form";
import { createMemberAction } from "@/lib/actions/people";
afterEach(() => {cleanup(); vi.clearAllMocks();});
it("protects a dirty member draft when leaving through shared navigation", () => {
  render(<><a href="/owner">Home</a><MemberCreateForm locations={[{id:"l1",name:"Main"}]} terminology={{overrides:{},locale:"en"}} /></>);
  fireEvent.change(screen.getByTestId("member-full-name"),{target:{value:"Synthetic Draft"}});
  fireEvent.click(screen.getByRole("link",{name:"Home"}));
  expect(screen.getByRole("dialog",{name:"Discard changes?"})).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Keep editing"}));
  expect((screen.getByTestId("member-full-name") as HTMLInputElement).value).toBe("Synthetic Draft");
  expect(push).not.toHaveBeenCalled();
});
it("follows the selected in-app destination only after explicit discard", async () => {
  render(<><a href="/owner/fees?tab=dues">Fees</a><MemberCreateForm locations={[{id:"l1",name:"Main"}]} terminology={{overrides:{},locale:"en"}} /></>);
  fireEvent.change(screen.getByTestId("member-full-name"),{target:{value:"Synthetic Draft"}});
  fireEvent.click(screen.getByRole("link",{name:"Fees"}));
  fireEvent.click(screen.getByRole("button",{name:"Discard changes"}));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/owner/fees?tab=dues"));
});
it("uses the configured singular person term when creating a member", () => {
  render(<MemberCreateForm locations={[{id:"l1",name:"Main"}]} terminology={{locale:"en",overrides:{member:{en:{one:"player",other:"players"}}}}} />);
  expect(screen.getByRole("button",{name:"Add player"})).toBeTruthy();
});
it("keeps the draft and framework state when Back is cancelled", async () => {
  window.history.replaceState({framework:"preserved"},"","/owner/members/new");
  render(<MemberCreateForm locations={[{id:"l1",name:"Main"}]} terminology={{overrides:{},locale:"en"}} />);
  fireEvent.change(screen.getByTestId("member-full-name"),{target:{value:"Synthetic Draft"}});
  expect(window.history.state.framework).toBe("preserved");
  window.history.back();
  expect(await screen.findByRole("dialog",{name:"Discard changes?"})).toBeTruthy();
  fireEvent.click(screen.getByRole("button",{name:"Keep editing"}));
  await waitFor(() => expect((screen.getByTestId("member-full-name") as HTMLInputElement).value).toBe("Synthetic Draft"));
  expect(window.history.state.framework).toBe("preserved");
  expect(push).not.toHaveBeenCalled();
});
it("arms only one entry for repeated edits and strips its marker on unmount without navigation", () => {
  window.history.replaceState({framework:"preserved"},"","/owner/members/new");
  const back = vi.spyOn(window.history,"back");
  const view = render(<MemberCreateForm locations={[{id:"l1",name:"Main"}]} terminology={{overrides:{},locale:"en"}} />);
  const initialLength = window.history.length;
  fireEvent.change(screen.getByTestId("member-full-name"),{target:{value:"First"}});
  expect(window.history.length).toBe(initialLength+1);
  fireEvent.change(screen.getByTestId("member-full-name"),{target:{value:"Second"}});
  expect(window.history.length).toBe(initialLength+1);
  view.unmount();
  expect(back).not.toHaveBeenCalled();
  expect(window.history.state).toEqual({framework:"preserved"});
  back.mockRestore();
});
it("discards once to the exact entry before the form", async () => {
  window.history.replaceState({previous:true},"","/owner/members?facility=all");
  window.history.pushState({framework:"preserved"},"","/owner/members/new");
  render(<MemberCreateForm locations={[{id:"l1",name:"Main"}]} terminology={{overrides:{},locale:"en"}} />);
  fireEvent.change(screen.getByTestId("member-full-name"),{target:{value:"Synthetic Draft"}});
  window.history.back();
  await screen.findByRole("dialog",{name:"Discard changes?"});
  fireEvent.click(screen.getByRole("button",{name:"Discard changes"}));
  await waitFor(() => expect(window.location.pathname+window.location.search).toBe("/owner/members?facility=all"));
  expect(push).not.toHaveBeenCalled();
});
it("does not intercept an unowned traversal event", () => {
  window.history.replaceState({framework:"preserved"},"","/owner/members/new");
  render(<MemberCreateForm locations={[{id:"l1",name:"Main"}]} terminology={{overrides:{},locale:"en"}} />);
  fireEvent.change(screen.getByTestId("member-full-name"),{target:{value:"Synthetic Draft"}});
  const observer = vi.fn();
  window.addEventListener("popstate",observer);
  window.dispatchEvent(new PopStateEvent("popstate",{state:{other:"entry"}}));
  window.removeEventListener("popstate",observer);
  expect(observer).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog",{name:"Discard changes?"})).toBeNull();
});
it("removes the guard when the draft is clean before Back", async () => {
  window.history.replaceState({previous:true},"","/owner/members?facility=all");
  window.history.pushState({framework:"preserved"},"","/owner/members/new");
  render(<MemberCreateForm locations={[{id:"l1",name:"Main"}]} terminology={{overrides:{},locale:"en"}} />);
  fireEvent.change(screen.getByTestId("member-full-name"),{target:{value:"Draft"}});
  fireEvent.change(screen.getByTestId("member-full-name"),{target:{value:""}});
  await waitFor(() => expect(window.history.state).toEqual({framework:"preserved"}));
  window.history.back();
  await waitFor(() => expect(window.location.pathname+window.location.search).toBe("/owner/members?facility=all"));
  expect(screen.queryByRole("dialog",{name:"Discard changes?"})).toBeNull();
});
it("re-arms once when a cleared form becomes dirty again", async () => {
  window.history.replaceState({framework:"preserved"},"","/owner/members/new");
  render(<MemberCreateForm locations={[{id:"l1",name:"Main"}]} terminology={{overrides:{},locale:"en"}} />);
  const input = screen.getByTestId("member-full-name");
  fireEvent.change(input,{target:{value:"First"}});
  fireEvent.change(input,{target:{value:""}});
  await waitFor(() => expect(window.history.state).toEqual({framework:"preserved"}));
  fireEvent.change(input,{target:{value:"Second"}});
  window.history.back();
  expect(await screen.findByRole("dialog",{name:"Discard changes?"})).toBeTruthy();
  expect((input as HTMLInputElement).value).toBe("Second");
});
it("keeps the same draft across repeated guarded Back attempts", async () => {
  window.history.replaceState({previous:true},"","/owner/members");
  window.history.pushState({framework:"preserved"},"","/owner/members/new");
  render(<MemberCreateForm locations={[{id:"l1",name:"Main"}]} terminology={{overrides:{},locale:"en"}} />);
  fireEvent.change(screen.getByTestId("member-full-name"),{target:{value:"Synthetic Draft"}});
  window.history.back();
  await screen.findByRole("dialog",{name:"Discard changes?"});
  fireEvent.click(screen.getByRole("button",{name:"Keep editing"}));
  window.history.back();
  await screen.findByRole("dialog",{name:"Discard changes?"});
  expect((screen.getByTestId("member-full-name") as HTMLInputElement).value).toBe("Synthetic Draft");
});
it("cleans the owned history entry before a confirmed save navigates", async () => {
  window.history.replaceState({framework:"preserved"},"","/owner/members/new");
  vi.mocked(createMemberAction).mockResolvedValueOnce({ok:true,memberId:"created"});
  render(<MemberCreateForm locations={[{id:"l1",name:"Main"}]} terminology={{overrides:{},locale:"en"}} />);
  fireEvent.change(screen.getByTestId("member-full-name"),{target:{value:"Synthetic Adult"}});
  fireEvent.change(screen.getByTestId("member-dob"),{target:{value:"01/01/1990"}});
  fireEvent.click(screen.getByTestId("consent-checkbox"));
  fireEvent.click(screen.getByTestId("submit-member"));
  await waitFor(() => expect(push).toHaveBeenCalledWith("/owner/members/created"));
  expect(window.history.state).toEqual({framework:"preserved"});
  expect(createMemberAction).toHaveBeenCalledTimes(1);
});
