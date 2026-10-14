// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Owner-UI review P1 (2026-10-13) — CSV import binds the chosen file,
// the preview and the committed text to one identity. A superseded
// validation response must never become the active preview, and the
// commit sends exactly the text the active preview was computed from.

const previewMemberImportAction = vi.hoisted(() => vi.fn());
const commitMemberImportAction = vi.hoisted(() => vi.fn());
vi.mock("@/lib/actions/member-import", () => ({
  previewMemberImportAction: (...args: unknown[]) =>
    previewMemberImportAction(...args),
  commitMemberImportAction: (...args: unknown[]) =>
    commitMemberImportAction(...args),
}));

import { MemberImportForm } from "@/components/member-import-form";
import type { MemberImportPreview } from "@/lib/services/member-import";

function preview(totalRows: number): MemberImportPreview {
  return {
    totalRows,
    rows: Array.from({ length: totalRows }, (_, i) => ({
      rowNumber: i + 2,
      fullName: `Member ${i + 1}`,
      dateOfBirth: "2015-01-01",
      locationName: "Worli",
    })),
    errors: [],
    missingColumns: [],
    fileError: null,
  } as unknown as MemberImportPreview;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function chooseFile(name: string, content: string) {
  const input = document.getElementById("member-import-file") as HTMLInputElement;
  const file = new File([content], name, { type: "text/csv" });
  fireEvent.change(input, { target: { files: [file] } });
}

afterEach(() => {
  cleanup();
  previewMemberImportAction.mockReset();
  commitMemberImportAction.mockReset();
});

describe("MemberImportForm file identity (P1)", () => {
  it("discards a late preview for a superseded file and commits the active file's text", async () => {
    const slowA = deferred<{ ok: true; preview: MemberImportPreview }>();
    const fastB = deferred<{ ok: true; preview: MemberImportPreview }>();
    previewMemberImportAction
      .mockImplementationOnce(() => slowA.promise)
      .mockImplementationOnce(() => fastB.promise);
    commitMemberImportAction.mockResolvedValue({
      ok: true,
      result: { imported: 2, skipped: 0, errors: [] },
    });

    render(<MemberImportForm />);

    chooseFile("register-a.csv", "name,date\nA,2015-01-01");
    await waitFor(() => expect(previewMemberImportAction).toHaveBeenCalledTimes(1));
    chooseFile("register-b.csv", "name,date\nB,2016-01-01\nC,2017-01-01");
    await waitFor(() => expect(previewMemberImportAction).toHaveBeenCalledTimes(2));

    // B resolves first and becomes the active preview…
    fastB.resolve({ ok: true, preview: preview(2) });
    await waitFor(() => expect(screen.getByText("register-b.csv")).toBeTruthy());
    // …then the older A response arrives and must be ignored.
    slowA.resolve({ ok: true, preview: preview(1) });
    await waitFor(() => expect(previewMemberImportAction).toHaveBeenCalledTimes(2));
    expect(screen.getByText("register-b.csv")).toBeTruthy();
    expect(screen.queryByText("register-a.csv")).toBeNull();
    expect(screen.getByText(/2 of 2 rows ready/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /import 2 members/i }));

    await waitFor(() =>
      expect(commitMemberImportAction).toHaveBeenCalledWith({
        csv: "name,date\nB,2016-01-01\nC,2017-01-01",
        attested: true,
        evidenceNote: "",
      }),
    );
  });

  it("ignores a second click while the commit is in flight", async () => {
    previewMemberImportAction.mockResolvedValue({ ok: true, preview: preview(1) });
    const commit = deferred<{
      ok: true;
      result: { imported: 1; skipped: 0; errors: [] };
    }>();
    commitMemberImportAction.mockImplementation(() => commit.promise);

    render(<MemberImportForm />);
    chooseFile("register.csv", "name,date\nA,2015-01-01");
    await screen.findByText(/1 of 1 row ready/i);
    fireEvent.click(screen.getByRole("checkbox"));

    const button = screen.getByRole("button", { name: /import 1 member/i });
    fireEvent.click(button);
    fireEvent.click(button);

    await waitFor(() =>
      expect(commitMemberImportAction).toHaveBeenCalledTimes(1),
    );
    commit.resolve({ ok: true, result: { imported: 1, skipped: 0, errors: [] } });
    await waitFor(() => expect(screen.getByText(/imported 1 member/i)).toBeTruthy());
  });
});
