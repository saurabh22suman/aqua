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
it("uses the configured member term for the directory heading and create action", async () => {
  const tree = await MembersPage({});
  const directory = tree.props.children;
  render(await directory.type(directory.props));
  expect(await screen.findByRole("heading",{name:"Players"})).toBeTruthy();
  expect(screen.getByRole("link",{name:/add player/i})).toBeTruthy();
});
it("uses the configured term in owner and reception create headings", async () => {
  const view = render(await OwnerNewMemberPage({}));
  expect(screen.getByRole("heading",{name:"Add player"})).toBeTruthy();
  view.unmount();
  render(await ReceptionNewMemberPage());
  expect(screen.getByRole("heading",{name:"Add player"})).toBeTruthy();
});
it("uses the configured term in reception directory", async () => {
  render(await ReceptionMembersPage({}));
  expect(screen.getByRole("heading",{name:"Find a player"})).toBeTruthy();
  expect(screen.getByLabelText("Search players")).toBeTruthy();
});
