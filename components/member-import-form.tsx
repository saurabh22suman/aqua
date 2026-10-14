"use client";

import { useRef, useState } from "react";
import {
  commitMemberImportAction,
  previewMemberImportAction,
} from "@/lib/actions/member-import";
import { memberImportErrorsCsv } from "@/lib/services/member-import-csv";
import { StickyActionBar } from "@/components/ui/StickyActionBar";
import type {
  MemberImportCommitResult,
  MemberImportPreview,
} from "@/lib/services/member-import";

// The attestation is the operator's fixed declaration, independent of
// a tenant's member/swimmer vocabulary. Keep the wording stable.
const IMPORT_ATTESTATION = "I confirm that valid consent has already been obtained for every member in this import and that supporting evidence is retained by the academy.";

// PR2-C5/C6 — CSV dry run + commit. P1 (2026-10-13 owner-UI review):
// file, preview and commit are one identity. Choosing a new file drops
// the old preview; out-of-order validation responses are discarded;
// commit sends the active preview's exact text; a guard makes
// double-clicks idempotent (the service also skips imported rows).

type ActivePreview = {
  // Monotonic identity for this preview. Responses carrying any other
  // id are stale.
  id: number;
  fileName: string;
  csv: string;
  preview: MemberImportPreview;
};

export function MemberImportForm() {
  const [fileName, setFileName] = useState<string | null>(null);
  const [active, setActive] = useState<ActivePreview | null>(null);
  const [committed, setCommitted] = useState<
    (MemberImportCommitResult & { fileName: string | null }) | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [attested, setAttested] = useState(false);
  const [evidenceNote, setEvidenceNote] = useState("");
  const checkSeq = useRef(0);
  const committing = useRef(false);

  async function check(file: File) {
    const id = ++checkSeq.current;
    // Immediate invalidation: the previous preview can never be
    // committed once a new file has been chosen, even while this
    // file is still being read.
    setBusy(true);
    setError(null);
    setActive(null);
    setCommitted(null);
    setAttested(false);
    setEvidenceNote("");
    setFileName(file.name);
    try {
      const csv = await file.text();
      if (id !== checkSeq.current) return;
      const result = await previewMemberImportAction({ csv });
      if (id !== checkSeq.current) return;
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setActive({ id, fileName: file.name, csv, preview: result.preview });
    } catch {
      if (id === checkSeq.current) {
        setError("The file could not be read. Export it again as CSV.");
      }
    } finally {
      if (id === checkSeq.current) setBusy(false);
    }
  }

  function commit() {
    // One commit at a time — a second click returns immediately. The
    // server skips rows that already exist, so even a duplicated
    // request cannot double-import, but we do not rely on that alone.
    if (!active || committing.current) return;
    committing.current = true;
    setBusy(true);
    setError(null);
    const previewId = active.id;
    const { csv, fileName: committedFile } = active;
    void (async () => {
      try {
        const result = await commitMemberImportAction({
          csv,
          attested,
          evidenceNote,
        });
        // If the user chose another file while this commit was in
        // flight, keep its preview; this result belongs to the older
        // file and is only reported as such.
        if (!result.ok) {
          setError(result.error);
          return;
        }
        setCommitted({ ...result.result, fileName: committedFile });
        setActive((current) =>
          current && current.id === previewId ? null : current,
        );
      } catch {
        setError("The import could not be completed. Try again.");
      } finally {
        committing.current = false;
        setBusy(false);
      }
    })();
  }

  const preview = active?.preview ?? null;
  const errorRows = committed ? committed.errors : (preview?.errors ?? []);

  function downloadErrors() {
    if (errorRows.length === 0) return;
    const blob = new Blob([memberImportErrorsCsv(errorRows)], {
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
              void check(file);
            }}
            className="mt-1.5 block w-full text-[16px] text-ink-2"
          />
        </label>
        <p className="mt-1.5 text-[12px] text-ink-3">
          {fileName
            ? active
              ? `Checked ${active.fileName}.`
              : `Reading ${fileName}…`
            : "Use the template so the columns match."}
        </p>
      </section>

      {busy && !preview ? (
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
          <p className="text-[12px] text-ink-3" data-testid="import-preview-file">
            Previewing <span className="font-medium text-ink-2">{active?.fileName}</span>
          </p>
          {preview.fileError ? (
            <p role="alert" className="mt-2 text-[13px] text-ink-2">{preview.fileError}</p>
          ) : preview.missingColumns.length > 0 ? (
            <p role="alert" className="mt-2 text-[13px] text-ink-2">
              Missing column{preview.missingColumns.length === 1 ? "" : "s"}:{" "}
              <span className="font-mono">
                {preview.missingColumns.join(", ")}
              </span>
              . Download the template and try again.
            </p>
          ) : (
            <>
              <p className="mt-1 text-[13px] text-ink">
                {preview.rows.length} of {preview.totalRows} row
                {preview.totalRows === 1 ? "" : "s"} ready
                {preview.errors.length > 0
                  ? ` · ${preview.errors.length} need fixing`
                  : ""}
                .
              </p>
              <p className="mt-2 text-[13px] text-ink-2">
                Preview makes no changes. Consent is recorded only after you confirm prior consent and import.
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
                    className="mt-3 min-h-11 rounded-pill border border-line px-3.5 py-1.5 text-[12.5px] font-medium text-ink-2 hover:text-ink"
                  >
                    Download error rows (CSV)
                  </button>
                </>
              ) : null}
            </>
          )}
        </section>
      ) : null}

      {preview && preview.rows.length > 0 ? (
        <StickyActionBar>
          <label className="mb-3 flex gap-3 text-[13px] text-ink">
            <input type="checkbox" checked={attested} onChange={(event) => setAttested(event.target.checked)} className="h-11 w-11 shrink-0" />
            <span>{IMPORT_ATTESTATION}</span>
          </label>
          <label className="mb-3 block text-[13px] text-ink-2">
            Evidence reference (optional)
            <input type="text" maxLength={500} value={evidenceNote} onChange={(event) => setEvidenceNote(event.target.value)} className="mt-1 block min-h-11 w-full rounded-ctl border border-line bg-paper px-3 text-[16px] text-ink" />
          </label>
          <button
            type="button"
            onClick={commit}
            disabled={busy || !attested}
            className="min-h-11 w-full rounded-pill px-5 py-2.5 text-[13px] font-semibold text-paper bg-[var(--accent-strong)] hover:opacity-90 disabled:opacity-60"
          >
            {busy
              ? "Importing…"
              : `Import ${preview.rows.length} member${
                  preview.rows.length === 1 ? "" : "s"
                } from ${active?.fileName ?? "the selected file"}`}
          </button>
        </StickyActionBar>
      ) : null}

      {committed ? (
        <section
          role="status"
          className="rounded-card border border-line bg-paper p-4"
        >
          <p className="text-[13px] text-ink">
            Imported {committed.imported} member
            {committed.imported === 1 ? "" : "s"}
            {committed.skipped > 0
              ? ` · ${committed.skipped} already existed and ${
                  committed.skipped === 1 ? "was" : "were"
                } skipped`
              : ""}
            {committed.fileName ? ` from ${committed.fileName}` : ""}.
          </p>
          {errorRows.length > 0 ? (
            <>
              <ul className="mt-3 space-y-1.5">
                {errorRows.slice(0, 20).map((rowError) => (
                  <li
                    key={`${rowError.rowNumber}-${rowError.field}`}
                    className="text-[12.5px] text-ink-2"
                  >
                    <span className="font-mono">row {rowError.rowNumber}</span> ·
                    {" "}{rowError.field} — {rowError.reason}
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={downloadErrors}
                className="mt-3 min-h-11 rounded-pill border border-line px-3.5 py-1.5 text-[12.5px] font-medium text-ink-2 hover:text-ink"
              >
                Download error rows (CSV)
              </button>
            </>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
