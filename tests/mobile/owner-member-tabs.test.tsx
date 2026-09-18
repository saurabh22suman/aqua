// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// U-03/V-11 — member 360 tabs. Overview / Payments / Progress / Notes
// / Documents. V-11 wires Progress to the generic framework (the tab
// was deliberately absent while M-03/V-10 were other workstreams).
// Notes render an honest empty state and a create form for writers;
// Documents states C-07 is unbuilt.

const listMemberNotesAction = vi.fn();
vi.mock("@/lib/actions/member-notes", () => ({
  listMemberNotesAction: (...args: unknown[]) => listMemberNotesAction(...args),
  createMemberNoteAction: vi.fn(),
  updateMemberNoteAction: vi.fn(),
  deleteMemberNoteAction: vi.fn(),
}));
vi.mock("next/link", async () => {
  const React = await import("react");
  return {
    default: (props: { href?: unknown; children?: unknown; [k: string]: unknown }) => {
      const { href, children, ...rest } = props;
      return React.createElement(
        "a",
        { href: typeof href === "string" ? href : "#", ...rest },
        children as React.ReactNode,
      );
    },
  };
});

import { MemberDetailTabs } from "@/components/member-detail/member-detail-tabs";
import { MemberNotesPanel } from "@/components/member-detail/member-notes-panel";
import { MemberDocumentsPanel } from "@/components/member-detail/member-documents-panel";

afterEach(() => {
  cleanup();
  listMemberNotesAction.mockReset();
});

describe("U-03 member tabs", () => {
  it("renders Overview / Payments / Progress / Notes / Documents", () => {
    render(<MemberDetailTabs memberId="m1" active="notes" />);
    const labels = Array.from(document.querySelectorAll("a")).map(
      (a) => a.textContent,
    );
    expect(labels).toEqual([
      "Overview",
      "Payments",
      "Progress",
      "Notes",
      "Documents",
    ]);
    const progress = Array.from(document.querySelectorAll("a")).find(
      (a) => a.textContent === "Progress",
    );
    expect(progress?.getAttribute("href")).toBe(
      "/owner/members/m1?tab=progress",
    );
    const notes = Array.from(document.querySelectorAll("a")).find(
      (a) => a.textContent === "Notes",
    );
    expect(notes?.getAttribute("href")).toBe("/owner/members/m1?tab=notes");
    expect(notes?.getAttribute("aria-current")).toBe("page");
  });
});

describe("U-03 notes panel", () => {
  it("shows the honest empty state and a create form for writers", async () => {
    listMemberNotesAction.mockResolvedValue([]);
    render(<MemberNotesPanel memberId="m1" canWrite />);
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/no notes on file/i),
    );
    expect(document.querySelector("textarea")).toBeTruthy();
    expect(document.body.textContent).toMatch(/never shown on the parent link/i);
  });

  it("hides the composer from read-only staff", async () => {
    listMemberNotesAction.mockResolvedValue([
      {
        id: "n1",
        body: "Called about the missed session.",
        authorName: "Owner",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        edited: false,
      },
    ]);
    render(<MemberNotesPanel memberId="m1" canWrite={false} />);
    await waitFor(() =>
      expect(document.body.textContent).toMatch(/called about the missed session/i),
    );
    expect(document.querySelector("textarea")).toBeNull();
    expect(document.body.textContent).not.toMatch(/Archive/);
  });
});

describe("U-03 documents tab", () => {
  it("states that document storage is not built, without an upload affordance", () => {
    render(<MemberDocumentsPanel />);
    expect(document.body.textContent).toMatch(/not built yet/i);
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });
});
