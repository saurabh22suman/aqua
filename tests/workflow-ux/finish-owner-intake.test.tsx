// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner finish lane — member intake and import. The new-member page had
// one visible path (fill the form) even though the register may already
// exist in a spreadsheet. The import had no next step after a completed
// commit and no explicit state when every checked row needed correction.

const actions = vi.hoisted(() => ({
  preview: vi.fn(),
  commit: vi.fn(),
}));

vi.mock("@/lib/auth/surface-guard", () => ({
  requireOwner: async () => ({
    tenantId: "tenant-1",
    userId: "user-1",
    roleKey: "owner",
    permissions: new Set(["members.read", "members.write"]),
    features: new Set(["members"]),
  }),
  requirePagePermission: (ctx: unknown) => ctx,
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock("@/lib/actions/people", () => ({
  listLocationsAction: async () => [{ id: "loc-1", name: "Worli" }],
}));
vi.mock("@/lib/actions/terminology", () => ({
  getTerminologyAction: async () => ({ locale: "en", overrides: {} }),
}));
vi.mock("@/components/member-create-form", () => ({
  MemberCreateForm: () => <p>Member form</p>,
}));
vi.mock("@/lib/actions/member-import", () => ({
  previewMemberImportAction: actions.preview,
  commitMemberImportAction: actions.commit,
}));

import NewMemberPage from "@/app/(owner)/owner/members/new/page";
import { MemberImportForm } from "@/components/member-import-form";
import type { MemberImportPreview } from "@/lib/services/member-import";

function preview(overrides: Partial<MemberImportPreview>): MemberImportPreview {
  return {
    totalRows: 1,
    rows: [
      {
        rowNumber: 2,
        fullName: "Anika Joshi",
        dateOfBirth: "2015-01-01",
        locationName: "Worli",
      },
    ],
    errors: [],
    missingColumns: [],
    fileError: null,
    ...overrides,
  } as unknown as MemberImportPreview;
}

function chooseFile(name = "register.csv") {
  const input = document.getElementById("member-import-file") as HTMLInputElement;
  fireEvent.change(input, {
    target: { files: [new File(["name,date"], name, { type: "text/csv" })] },
  });
}

afterEach(() => {
  cleanup();
  actions.preview.mockReset();
  actions.commit.mockReset();
});

describe("new member intake", () => {
  it("explains what is saved and offers the spreadsheet route beside the form", async () => {
    render(await NewMemberPage({ searchParams: Promise.resolve({}) }));

    expect(screen.getByText(/enrol the member in a batch/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Import a list" }).getAttribute("href")).toBe(
      "/owner/members/import",
    );
  });
});

describe("member import next steps", () => {
  it("offers the members list and a fresh import after a completed commit", async () => {
    actions.preview.mockResolvedValue({ ok: true, preview: preview({}) });
    actions.commit.mockResolvedValue({
      ok: true,
      result: { imported: 1, skipped: 0, errors: [] },
    });

    render(<MemberImportForm />);
    chooseFile();
    await screen.findByText("1 ready");
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /import 1 member/i }));
    await screen.findByText(/imported 1 member/i);

    expect(screen.getByRole("link", { name: "View members" }).getAttribute("href")).toBe(
      "/owner/members",
    );

    fireEvent.click(screen.getByRole("button", { name: "Import another file" }));

    expect(screen.queryByText(/imported 1 member/i)).toBeNull();
    expect(document.getElementById("member-import-file")).toBeTruthy();
    expect(screen.getByText(/use the template so the columns match/i)).toBeTruthy();
  });

  it("says plainly when no row can be imported yet", async () => {
    actions.preview.mockResolvedValue({
      ok: true,
      preview: preview({
        rows: [],
        errors: [{ rowNumber: 2, field: "fullName", reason: "Required" }],
      }),
    });

    render(<MemberImportForm />);
    chooseFile();

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toMatch(/no rows can be imported/i),
    );
    expect(screen.getByRole("button", { name: /download error rows/i })).toBeTruthy();
  });
});
