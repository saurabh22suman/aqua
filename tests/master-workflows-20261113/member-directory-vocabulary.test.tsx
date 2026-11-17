// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/auth/surface-guard", () => ({requireOwner:async () => ({roleKey:"owner",permissions:new Set(["members.read","members.write"])}),requireReception:async () => ({permissions:new Set(["members.read","members.write"])}),requirePagePermission:vi.fn()}));
vi.mock("next/headers", () => ({cookies:async () => ({get:() => undefined})}));
vi.mock("@/lib/actions/people", () => ({listMembersAction:async () => [],listLocationsAction:async () => []}));
vi.mock("@/lib/actions/terminology", () => ({getTerminologyAction:async () => ({locale:"en",overrides:{member:{en:{one:"player",other:"players"}}}})}));
vi.mock("@/components/members-board", () => ({MembersBoard:() => null}));
vi.mock("@/components/member-create-form", () => ({MemberCreateForm:() => null}));
import MembersPage from "@/app/(owner)/owner/members/page";
import OwnerNewMemberPage from "@/app/(owner)/owner/members/new/page";
import ReceptionNewMemberPage from "@/app/(reception)/reception/members/new/page";
import ReceptionMembersPage from "@/app/(reception)/reception/members/page";
afterEach(cleanup);
it("uses stable multisport owner terms despite a club player override", async () => {
  const tree = await MembersPage({});
  const directory = tree.props.children;
  render(await directory.type(directory.props));
  expect(await screen.findByRole("heading",{name:"Members"})).toBeTruthy();
  expect(screen.getByRole("link",{name:/add member/i})).toBeTruthy();
});
it("uses stable Owner and Reception terms despite the player override", async () => {
  const view = render(await OwnerNewMemberPage({}));
  expect(screen.getByRole("heading",{name:"Add member"})).toBeTruthy();
  view.unmount();
  render(await ReceptionNewMemberPage());
  expect(screen.getByRole("heading",{name:"Add member"})).toBeTruthy();
  expect(screen.queryByRole("heading",{name:"Add player"})).toBeNull();
});
it("uses stable member terms in the reception directory despite the player override", async () => {
  render(await ReceptionMembersPage({}));
  expect(screen.getByRole("heading",{name:"Find a member"})).toBeTruthy();
  expect(screen.getByLabelText("Search members")).toBeTruthy();
  expect(screen.queryByLabelText("Search players")).toBeNull();
});
