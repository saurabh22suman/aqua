// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReportPreferencesEditor, ReportPreferenceFilter } from "@/components/reports/owner-approved/report-preferences";
import { reportPreferenceKey, type ReportFamily } from "@/lib/owner-reports/preferences";

const identity = { tenantId: "tenant/a", userId: "user/a" };
const all: ReportFamily[] = ["attendance", "members", "staff", "batches", "collections"];
const key = reportPreferenceKey(identity);
beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("defaults to available families, saves a toggle and restores it on remount", () => {
  const view = render(<ReportPreferencesEditor identity={identity} available={all} />);
  expect(screen.getAllByRole("switch")).toHaveLength(5);
  expect(screen.getByRole("switch", { name: "Members" }).getAttribute("aria-checked")).toBe("true");
  fireEvent.click(screen.getByRole("switch", { name: "Members" }));
  expect(screen.getByRole("switch", { name: "Members" }).getAttribute("aria-checked")).toBe("false");
  view.unmount();
  render(<ReportPreferencesEditor identity={identity} available={all} />);
  expect(screen.getByRole("switch", { name: "Members" }).getAttribute("aria-checked")).toBe("false");
});

it("keeps other identities and unrelated storage untouched", () => {
  window.localStorage.setItem("unrelated", "keep");
  const view = render(<ReportPreferencesEditor identity={identity} available={all} />);
  fireEvent.click(screen.getByRole("switch", { name: "Attendance" }));
  view.unmount();
  render(<ReportPreferencesEditor identity={{ tenantId: "tenant/a", userId: "other" }} available={all} />);
  expect(screen.getByRole("switch", { name: "Attendance" }).getAttribute("aria-checked")).toBe("true");
  expect(window.localStorage.getItem("unrelated")).toBe("keep");
  expect(reportPreferenceKey({ tenantId: "tenant", userId: "a/user/a" })).not.toBe(key);
});

it("falls back safely for invalid data and warns on denied save", () => {
  window.localStorage.setItem(key, '{"attendance":"false"}');
  render(<ReportPreferencesEditor identity={identity} available={all} />);
  expect(screen.getByRole("switch", { name: "Attendance" }).getAttribute("aria-checked")).toBe("true");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("denied"); });
  fireEvent.click(screen.getByRole("switch", { name: "Attendance" }));
  expect(screen.getByRole("status").textContent).toMatch(/could not save/i);
});

it("uses defaults when reading storage is denied", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("denied"); });
  render(<ReportPreferencesEditor identity={identity} available={all} />);
  expect(screen.getByRole("switch", { name: "Members" }).getAttribute("aria-checked")).toBe("true");
});

it("retains choices for currently unavailable families when changing another choice", () => {
  window.localStorage.setItem(key, JSON.stringify({ attendance: true, members: true, staff: false, batches: true, collections: false }));
  const view = render(<ReportPreferencesEditor identity={identity} available={["attendance", "members"]} />);
  expect(screen.queryByRole("switch", { name: "Collections" })).toBeNull();
  fireEvent.click(screen.getByRole("switch", { name: "Members" }));
  view.unmount();
  render(<ReportPreferencesEditor identity={identity} available={all} />);
  expect(screen.getByRole("switch", { name: "Collections" }).getAttribute("aria-checked")).toBe("false");
  expect(screen.getByRole("switch", { name: "Staff" }).getAttribute("aria-checked")).toBe("false");
});

it("filters only an already-authorized family and never expands the permitted list", () => {
  window.localStorage.setItem(key, JSON.stringify({ attendance: false, members: true, staff: true, batches: true, collections: true }));
  render(<><ReportPreferenceFilter identity={identity} available={["attendance"]} family="attendance"><p>attendance content</p></ReportPreferenceFilter><ReportPreferenceFilter identity={identity} available={["attendance"]} family="collections"><p>financial content</p></ReportPreferenceFilter></>);
  expect(screen.queryByText("attendance content")).toBeNull();
  expect(screen.queryByText("financial content")).toBeNull();
});
