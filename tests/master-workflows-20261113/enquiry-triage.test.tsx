// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/actions/enquiries", () => ({createEnquiryAction: vi.fn()}));
import { EnquiriesBoard } from "@/components/enquiries-board";
import type { EnquiryRow } from "@/lib/services/enquiries";
afterEach(cleanup);
it("starts with active enquiries and allows searching converted history", () => {
  const base = {phone:null,source:"walk-in",memberId:null,locationId:"a",createdAt:new Date("2026-11-01T00:00:00Z")};
  const rows = [{...base,id:"a",fullName:"Active Person",stage:"new"},{...base,id:"b",fullName:"Finished Person",stage:"converted"}] as EnquiryRow[];
  render(<EnquiriesBoard initialEnquiries={rows} locations={[]} canWrite={false} variant="oversight" />);
  expect(screen.getAllByText("Active Person").length).toBeGreaterThan(0);
  expect(screen.queryByText("Finished Person")).toBeNull();
  fireEvent.change(screen.getByLabelText("Stage"),{target:{value:"converted"}});
  fireEvent.change(screen.getByLabelText("Search enquiries"),{target:{value:"Finished"}});
  expect(screen.getAllByText("Finished Person").length).toBeGreaterThan(0);
});
it("shows a due follow-up with its reason ahead of the active queue", () => {
  const row = {id:"a",fullName:"Active Person",phone:null,source:"walk-in",stage:"new",memberId:null,locationId:"a",createdAt:new Date("2026-11-01T00:00:00Z")} as EnquiryRow;
  const followUps = [{id:"f",enquiryId:"a",enquiryName:"Active Person",dueAt:new Date("2026-11-10T00:00:00Z"),note:"Call about trial"}];
  render(<EnquiriesBoard initialEnquiries={[row]} locations={[]} canWrite={false} variant="oversight" {...{overdueFollowUps:followUps}} />);
  expect(screen.getByRole("heading",{name:/overdue follow-ups/i})).toBeTruthy();
  expect(screen.getByText("Call about trial")).toBeTruthy();
  expect(screen.getByRole("link",{name:/follow up.*Active Person/i}).getAttribute("href")).toBe("/owner/enquiries/a");
});
it("restores the selected history filter on returning to the same account's entry", async () => {
  const row = {id:"b",fullName:"Finished Person",phone:null,source:"walk-in",stage:"converted",memberId:null,locationId:"a",createdAt:new Date("2026-11-01T00:00:00Z")} as EnquiryRow;
  const props = {initialEnquiries:[row],locations:[],canWrite:false,variant:"oversight" as const,navigationNamespace:"tenant-a:user-a"};
  const first = render(<EnquiriesBoard {...props} />);
  fireEvent.change(screen.getByLabelText("Stage"),{target:{value:"converted"}});
  fireEvent.change(screen.getByLabelText("Search enquiries"),{target:{value:"Finished"}});
  first.unmount();
  render(<EnquiriesBoard {...props} />);
  const {waitFor} = await import("@testing-library/react");
  await waitFor(() => expect((screen.getByLabelText("Search enquiries") as HTMLInputElement).value).toBe("Finished"));
  expect((screen.getByLabelText("Stage") as HTMLSelectElement).value).toBe("converted");
  expect(window.location.href).not.toContain("Finished");
});
it("does not restore an enquiry search into another tenant or account", () => {
  const props = {initialEnquiries:[],locations:[],canWrite:false,variant:"oversight" as const};
  const first = render(<EnquiriesBoard {...props} navigationNamespace="tenant-a:user-a" />);
  fireEvent.change(screen.getByLabelText("Search enquiries"),{target:{value:"private query"}});
  first.unmount();
  render(<EnquiriesBoard {...props} navigationNamespace="tenant-b:user-b" />);
  expect((screen.getByLabelText("Search enquiries") as HTMLInputElement).value).toBe("");
  expect(window.location.href).not.toContain("private");
});
