// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("@/lib/actions/enquiries", () => ({ createEnquiryAction: vi.fn() }));
import { EnquiriesBoard } from "@/components/enquiries-board";
import type { EnquiryRow } from "@/lib/services/enquiries";

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
});
const names = ["Asha Longname", "Bela", "Charu", "Divya", "Esha"];
const rows = names.map((fullName, i) => ({
  id: String(i), fullName, phone: i === 0 ? "9876543210" : null,
  source: "walk-in", stage: i === 4 ? "converted" : "new", memberId: null,
  locationId: "site", createdAt: new Date("2026-11-01T00:00:00Z"),
})) as EnquiryRow[];
const followUps = [3, 1, 2, 0].map((i) => ({
  id: `f${i}`, enquiryId: String(i), enquiryName: names[i],
  dueAt: new Date(`2026-11-${String(10 + i).padStart(2, "0")}T00:00:00Z`),
  note: `Note ${i}`,
}));
const props = {
  initialEnquiries: rows, locations: [{ id: "site", name: "Site" }],
  canWrite: false, variant: "oversight" as const, overdueFollowUps: followUps,
  detailHrefPrefix: "/owner/enquiries",
};

it("shows the earliest three overdue follow-ups, then exposes and collapses all supplied records", () => {
  render(<EnquiriesBoard {...props} />);
  const section = screen.getByRole("heading", { name: /overdue follow-ups/i }).closest("section")!;
  expect(within(section).getByText(/4 overdue/i)).toBeTruthy();
  expect(within(section).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/owner/enquiries/0", "/owner/enquiries/1", "/owner/enquiries/2"]);
  expect(within(section).getByText(/10 Nov 2026/i)).toBeTruthy();
  expect(within(section).queryByText("Note 3")).toBeNull();
  fireEvent.click(within(section).getByRole("button", { name: /show all/i }));
  expect(within(section).getByText("Note 3")).toBeTruthy();
  expect(within(section).getByRole("link", { name: /follow up Divya/i }).getAttribute("href")).toBe("/owner/enquiries/3");
  fireEvent.click(within(section).getByRole("button", { name: /show fewer/i }));
  expect(within(section).queryByText("Note 3")).toBeNull();
});

it("reports shown and total, searches phone, and shows all enquiries after no match", () => {
  render(<EnquiriesBoard {...props} />);
  expect(screen.getByText(/4 of 5 enquiries/i)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Search enquiries"), { target: { value: "987654" } });
  expect(screen.getByText(/1 of 5 enquiries/i)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Stage"), { target: { value: "converted" } });
  expect(screen.getByText(/0 of 5 enquiries/i)).toBeTruthy();
  expect(screen.getByText(/no enquiries match/i)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Show all enquiries" }));
  expect((screen.getByLabelText("Search enquiries") as HTMLInputElement).value).toBe("");
  expect((screen.getByLabelText("Stage") as HTMLSelectElement).value).toBe("all");
  expect(screen.getByText(/5 of 5 enquiries/i)).toBeTruthy();
});

it("recovers closed-only enquiries and remembers the all-history selection privately", () => {
  const closed = [rows[4], { ...rows[3], stage: "lost" } as EnquiryRow];
  const closedProps = { ...props, initialEnquiries: closed, overdueFollowUps: [], navigationNamespace: "closed-tenant:closed-user" };
  window.history.replaceState({}, "", "/?location=site");
  const view = render(<EnquiriesBoard {...closedProps} />);
  expect(screen.getByText(/0 of 2 enquiries/i)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Search enquiries"), { target: { value: "private search" } });
  fireEvent.click(screen.getByRole("button", { name: "Show all enquiries" }));
  expect((screen.getByLabelText("Search enquiries") as HTMLInputElement).value).toBe("");
  expect((screen.getByLabelText("Stage") as HTMLSelectElement).value).toBe("all");
  expect(screen.getByText(/2 of 2 enquiries/i)).toBeTruthy();
  expect(screen.getAllByText("Esha").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Divya").length).toBeGreaterThan(0);
  expect(window.location.search).toBe("?location=site");
  view.unmount();
  render(<EnquiriesBoard {...closedProps} />);
  expect((screen.getByLabelText("Search enquiries") as HTMLInputElement).value).toBe("");
  expect((screen.getByLabelText("Stage") as HTMLSelectElement).value).toBe("all");
  expect(screen.getByText(/2 of 2 enquiries/i)).toBeTruthy();
});

it("filters overdue follow-ups with the current search and stage and restores matching history", () => {
  const extra = { id: "extra", enquiryId: "other", enquiryName: "Other person", dueAt: new Date("2026-11-09T20:00:00Z"), note: "Unknown row" };
  const history = { id: "history", enquiryId: "4", enquiryName: "Esha", dueAt: new Date("2026-11-09T20:00:00Z"), note: "History note" };
  render(<EnquiriesBoard {...props} overdueFollowUps={[...followUps, extra, history]} />);
  fireEvent.change(screen.getByLabelText("Search enquiries"), { target: { value: "Bela" } });
  let section = screen.getByRole("heading", { name: /overdue follow-ups/i }).closest("section")!;
  expect(within(section).getByText(/1 overdue/i)).toBeTruthy();
  expect(within(section).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/owner/enquiries/1"]);
  expect(within(section).getByText(/11 Nov 2026/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Search enquiries"), { target: { value: "Esha" } });
  expect(screen.queryByRole("heading", { name: /overdue follow-ups/i })).toBeNull();
  fireEvent.change(screen.getByLabelText("Stage"), { target: { value: "all" } });
  section = screen.getByRole("heading", { name: /overdue follow-ups/i }).closest("section")!;
  expect(within(section).getByText(/10 Nov 2026/)).toBeTruthy();
  expect(within(section).getByText("History note")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Search enquiries"), { target: { value: "" } });
  expect(within(section).getByText(/5 overdue/i)).toBeTruthy();
  fireEvent.click(within(section).getByRole("button", { name: /show all/i }));
  expect(within(section).getAllByRole("link")).toHaveLength(5);
  expect(within(section).queryByText("Unknown row")).toBeNull();
});

it("has a named open action for the mobile list and retains a long name", () => {
  const longName = "A remarkably long enquiry name that must remain fully readable on a narrow phone screen";
  render(<EnquiriesBoard {...props} initialEnquiries={[{ ...rows[0], fullName: longName }]} overdueFollowUps={[]} />);
  const list = screen.getByTestId("enquiries-list");
  const mobile = list.querySelector("ul")!;
  const link = within(mobile).getByRole("link", { name: new RegExp(`open ${longName}`, "i") });
  expect(link.getAttribute("href")).toBe("/owner/enquiries/0");
  expect(link.textContent).toContain(longName);
});

it("keeps row links named without repeating visible open instructions", () => {
  render(<EnquiriesBoard {...props} />);
  const mobile = screen.getByTestId("enquiries-list").querySelector("ul")!;
  expect(within(mobile).getByRole("link", { name: "Open Bela" })).toBeTruthy();
  expect(within(mobile).queryAllByText("Open enquiry")).toHaveLength(0);
  const overdue = screen.getByRole("heading", { name: /overdue follow-ups/i }).closest("section")!;
  expect(within(overdue).getByRole("link", { name: "Follow up Bela" })).toBeTruthy();
  expect(within(overdue).queryAllByText("Open enquiry to review")).toHaveLength(0);
});

it("preserves read-only and front-desk capture behavior", () => {
  const view = render(<EnquiriesBoard {...props} />);
  expect(screen.getByText(/role can view enquiries but not capture/i)).toBeTruthy();
  expect(screen.queryByRole("button", { name: /add enquiry/i })).toBeNull();
  view.unmount();
  render(<EnquiriesBoard {...props} canWrite variant="front-desk" />);
  expect(screen.queryByLabelText("Search enquiries")).toBeNull();
  expect(screen.queryByRole("heading", { name: /overdue follow-ups/i })).toBeNull();
  expect(screen.getByLabelText("Name")).toBeTruthy();
});

it("keeps private filters out of the URL and does not restore them across namespaces", () => {
  window.history.replaceState({}, "", "/?location=site");
  const view = render(<EnquiriesBoard {...props} navigationNamespace="tenant-a:user-a" />);
  fireEvent.change(screen.getByLabelText("Search enquiries"), { target: { value: "private-name" } });
  expect(window.location.search).toBe("?location=site");
  view.unmount();
  render(<EnquiriesBoard {...props} navigationNamespace="tenant-b:user-b" />);
  expect((screen.getByLabelText("Search enquiries") as HTMLInputElement).value).toBe("");
});
