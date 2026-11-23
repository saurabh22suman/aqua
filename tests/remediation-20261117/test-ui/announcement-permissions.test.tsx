// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ permissions: new Set<string>(), history: vi.fn(async () => []), batches: vi.fn(async () => []), props: vi.fn() }));
vi.mock("@/lib/auth/surface-guard", () => ({ requireOwner: async () => ({ permissions: state.permissions, features: new Set(["messaging"]) }), requirePagePermission: () => {} }));
vi.mock("@/lib/actions/announcements", () => ({ listAnnouncementsAction: state.history, listMyNotificationsAction: async () => [] }));
vi.mock("@/lib/actions/programs", () => ({ listBatchesAction: state.batches }));
vi.mock("@/lib/actions/terminology", () => ({ getTerminologyAction: async () => ({overrides:{},locale:"en"}) }));
vi.mock("@/components/announcements/announcement-composer", () => ({AnnouncementComposer: (props: unknown) => {state.props(props);return <div>Composer</div>;}}));
vi.mock("@/components/announcements/notification-inbox", () => ({NotificationInbox: () => <div>Inbox</div>}));
import Page from "@/app/(owner)/owner/announcements/page";
afterEach(() => {cleanup();vi.clearAllMocks();});
it("permits a sender without directory or programs reads without querying either", async () => {
  state.permissions = new Set(["messaging.send"]);
  render(await Page());
  expect(screen.getByText("Composer")).toBeTruthy();
  expect(state.history).not.toHaveBeenCalled();
  expect(state.batches).not.toHaveBeenCalled();
  expect(screen.queryByRole("region",{name:"Sent history"})).toBeNull();
  expect(state.props).toHaveBeenCalledWith(expect.objectContaining({canSelectBatch:false}));
});
it("reads permitted history and batch options", async () => {
  state.permissions = new Set(["messaging.send","members.read","programs.read"]);
  render(await Page());
  expect(state.history).toHaveBeenCalledOnce();
  expect(state.batches).toHaveBeenCalledOnce();
  expect(screen.getByRole("region",{name:"Sent history"})).toBeTruthy();
  expect(state.props).toHaveBeenCalledWith(expect.objectContaining({canSelectBatch:true}));
});
