// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/actions/people", () => ({ createMemberAction: vi.fn(), searchPersonsAction: vi.fn() }));
import { MemberCreateForm } from "@/components/member-create-form";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-13T12:00:00Z")); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("disables tomorrow in the date-of-birth calendar", () => {
  render(<MemberCreateForm locations={[{id:"l1",name:"Main"}]} terminology={{overrides:{},locale:"en"}} />);
  fireEvent.click(screen.getAllByRole("button", {name:"Choose date"})[0]!);
  expect((screen.getByRole("button", {name:"14 November 2026"}) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole("button", {name:"13 November 2026"}) as HTMLButtonElement).disabled).toBe(false);
});

it("keeps keyboard focus on today rather than moving into tomorrow", () => {
  render(<MemberCreateForm locations={[{id:"l1",name:"Main"}]} terminology={{overrides:{},locale:"en"}} />);
  fireEvent.click(screen.getAllByRole("button", {name:"Choose date"})[0]!);
  const today = screen.getByRole("button", {name:"13 November 2026"});
  today.focus();
  fireEvent.keyDown(today, {key:"ArrowRight"});
  expect(document.activeElement).toBe(today);
  expect((screen.getByRole("button", {name:"14 November 2026"}) as HTMLButtonElement).disabled).toBe(true);
});

it("shows immediate future-date feedback without requesting a guardian", () => {
  render(<MemberCreateForm locations={[{id:"l1",name:"Main"}]} terminology={{overrides:{},locale:"en"}} />);
  fireEvent.change(screen.getByTestId("member-dob"), {target:{value:"14/11/2026"}});
  expect(screen.getByText(/date of birth cannot be in the future/i)).toBeTruthy();
  expect(screen.queryByTestId("guardian-search")).toBeNull();
});

it("keeps a future joined-on date selectable", () => {
  render(<MemberCreateForm locations={[{id:"l1",name:"Main"}]} terminology={{overrides:{},locale:"en"}} />);
  fireEvent.click(screen.getAllByRole("button", {name:"Choose date"})[1]!);
  expect((screen.getByRole("button", {name:"14 November 2026"}) as HTMLButtonElement).disabled).toBe(false);
});

it("keeps Today and Clear working in the uncapped optional picker", () => {
  render(<MemberCreateForm locations={[{id:"l1",name:"Main"}]} terminology={{overrides:{},locale:"en"}} />);
  const joined = screen.getByTestId("member-joined-on") as HTMLInputElement;
  fireEvent.click(screen.getAllByRole("button", {name:"Choose date"})[1]!);
  fireEvent.click(screen.getByRole("button", {name:"Today"}));
  expect(joined.value).toBe("13/11/2026");
  fireEvent.click(screen.getAllByRole("button", {name:"Choose date"})[1]!);
  fireEvent.click(screen.getByRole("button", {name:"Clear"}));
  expect(joined.value).toBe("");
});

it("uses the IST day after the UTC evening boundary", () => {
  vi.setSystemTime(new Date("2026-11-13T18:45:00Z"));
  render(<MemberCreateForm locations={[{id:"l1",name:"Main"}]} terminology={{overrides:{},locale:"en"}} />);
  fireEvent.click(screen.getAllByRole("button", {name:"Choose date"})[0]!);
  expect((screen.getByRole("button", {name:"14 November 2026"}) as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByRole("button", {name:"15 November 2026"}) as HTMLButtonElement).disabled).toBe(true);
});

it("selects a leap-day birthday and asks for the guardian", () => {
  vi.setSystemTime(new Date("2024-03-01T06:00:00Z"));
  render(<MemberCreateForm locations={[{id:"l1",name:"Main"}]} terminology={{overrides:{},locale:"en"}} />);
  fireEvent.click(screen.getAllByRole("button", {name:"Choose date"})[0]!);
  fireEvent.click(screen.getByRole("button", {name:"Previous month"}));
  fireEvent.click(screen.getByRole("button", {name:"29 February 2024"}));
  expect((screen.getByTestId("member-dob") as HTMLInputElement).value).toBe("29/02/2024");
  expect(screen.getByTestId("guardian-search")).toBeTruthy();
});

it.each([["13 November 2008", false], ["14 November 2008", true]])(
  "classifies an 18th-birthday boundary selected in the calendar: %s",
  (birthday, guardianExpected) => {
    render(<MemberCreateForm locations={[{id:"l1",name:"Main"}]} terminology={{overrides:{},locale:"en"}} />);
    fireEvent.click(screen.getAllByRole("button", {name:"Choose date"})[0]!);
    fireEvent.change(screen.getByLabelText("Year"), {target:{value:"2008"}});
    fireEvent.click(screen.getByRole("button", {name:birthday}));
    expect(Boolean(screen.queryByTestId("guardian-search"))).toBe(guardianExpected);
  },
);
