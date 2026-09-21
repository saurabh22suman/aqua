"use client";

import { useState } from "react";
import { previewMemberImportAction } from "@/lib/actions/member-import";
import { memberImportErrorsCsv } from "@/lib/services/member-import-csv";
import type { MemberImportPreview } from "@/lib/services/member-import";

// PR2-C5 — the import screen's dry run. Pick the CSV, see exactly
// what would land and what was rejected (row number, field, reason),
// download the rejected rows. Nothing is written from here.

export function MemberImportForm() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [preview, setPreview] = useState<MemberImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function check(file: File) {
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      const csv = await file.text();
      const result = await previewMemberImportAction({ csv });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPreview(result.preview);
    } catch {
      setError("The file could not be read. Export it again as CSV.");
    } finally {
      setBusy(false);
    }
  }

  function downloadErrors() {
    if (!preview || preview.errors.length === 0) return;
    const blob = new Blob([memberImportErrorsCsv(preview.errors)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "member-import-errors.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <section className="rounded-card border border-line bg-paper p-4">
        <label className="block" htmlFor="member-import-file">
          <span className="block text-[13px] font-medium text-ink-2">
            CSV file
          </span>
          <input
            id="member-import-file"
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setFileName(file.name);
              void check(file);
            }}
            className="mt-1.5 block w-full text-[13px] text-ink-2"
          />
        </label>
        <p className="mt-1.5 text-[12px] text-ink-3">
          {fileName
            ? `Reading ${fileName}…`
            : "Use the template so the columns match."}
        </p>
      </section>

      {busy ? (
        <p className="text-[13px] text-ink-3">Checking the file…</p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-ctl border border-line bg-deck px-3 py-2 text-[13px] text-ink-2"
        >
          {error}
        </p>
      ) : null}

      {preview ? (
        <section className="rounded-card border border-line bg-paper p-4">
          {preview.missingColumns.length > 0 ? (
            <p role="alert" className="text-[13px] text-ink-2">
              Missing column{preview.missingColumns.length === 1 ? "" : "s"}:{" "}
              <span className="font-mono">
                {preview.missingColumns.join(", ")}
              </span>
              . Download the template and try again.
            </p>
          ) : (
            <>
              <p className="text-[13px] text-ink">
                {preview.rows.length} of {preview.totalRows} row
                {preview.totalRows === 1 ? "" : "s"} ready
                {preview.errors.length > 0
                  ? ` · ${preview.errors.length} need fixing`
                  : ""}
                .
              </p>

              {preview.errors.length > 0 ? (
                <>
                  <ul className="mt-3 space-y-1.5">
                    {preview.errors.slice(0, 20).map((rowError) => (
                      <li
                        key={`${rowError.rowNumber}-${rowError.field}`}
                        className="text-[12.5px] text-ink-2"
                      >
                        <span className="font-mono">row {rowError.rowNumber}</span>{" "}
                        · {rowError.field} — {rowError.reason}
                      </li>
                    ))}
                  </ul>
                  {preview.errors.length > 20 ? (
                    <p className="mt-1 text-[12px] text-ink-3">
                      Showing the first 20; download the full list.
                    </p>
                  ) : null}
                  <button
                    type="button"
                    onClick={downloadErrors}
                    className="mt-3 rounded-pill border border-line px-3.5 py-1.5 text-[12.5px] font-medium text-ink-2 hover:text-ink"
                  >
                    Download error rows (CSV)
                  </button>
                </>
              ) : null}
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
