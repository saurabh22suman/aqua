"use client";

import { useRef, useState } from "react";
import {
  commitMemberImportAction,
  previewMemberImportAction,
} from "@/lib/actions/member-import";
import { memberImportErrorsCsv } from "@/lib/services/member-import-csv";
import { formatDateIST } from "@/lib/time/tz";
import { StickyActionBar } from "@/components/ui/StickyActionBar";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
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
            className="mt-1.5 block min-h-12 w-full rounded-ctl border border-[var(--control-border)] bg-[var(--control-surface-picker)] px-2 py-1 text-[16px] text-ink-2 file:mr-3 file:min-h-9 file:rounded-[8px] file:border-0 file:bg-[var(--control-surface-action)] file:px-3 file:text-[13px] file:font-medium file:text-ink-2 motion-fast transition-colors hover:border-[var(--control-border-hover)] focus:border-[var(--accent-strong)] disabled:cursor-not-allowed disabled:opacity-60"
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
          <h2 className="font-display text-[16px] font-semibold">
            Review {active?.fileName}
          </h2>
          <p className="mt-0.5 text-[12px] text-ink-3" data-testid="import-preview-file">
            Nothing is saved until you confirm the checked rows.
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
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="rounded-pill bg-deck px-2.5 py-1 text-[11px] font-medium text-ink-2">
                  {preview.rows.length} ready
                </span>
                {preview.errors.length > 0 ? (
                  <span className="rounded-pill border border-line bg-paper px-2.5 py-1 text-[11px] font-medium text-ink-2">
                    {preview.errors.length} need correction
                  </span>
                ) : null}
                <span className="text-[12px] text-ink-3">
                  {preview.totalRows} row{preview.totalRows === 1 ? "" : "s"} in
                  the file
                </span>
              </div>
              <p className="mt-2 text-[13px] text-ink-2">
                Preview makes no changes. Consent is recorded only after you confirm prior consent and import.
              </p>

              {preview.rows.length > 0 ? (
                <div className="mt-3 overflow-hidden rounded-ctl border border-line">
                  <div className="hidden grid-cols-[3.5rem_minmax(0,1.4fr)_auto_minmax(0,1fr)] gap-2 border-b border-line bg-deck px-3 py-2 text-[11px] uppercase tracking-[0.08em] text-ink-3 md:grid">
                    <span>CSV row</span>
                    <span>Name</span>
                    <span>Date of birth</span>
                    <span>Location</span>
                  </div>
                  <ul>
                    {preview.rows.slice(0, 8).map((row) => (
                      <li
                        key={row.rowNumber}
                        className="grid grid-cols-1 gap-1 border-b border-line px-3 py-2.5 text-[12.5px] last:border-0 md:grid-cols-[3.5rem_minmax(0,1.4fr)_auto_minmax(0,1fr)] md:items-center md:gap-2"
                      >
                        <span className="text-[11px] text-ink-3 md:text-[12px]">
                          Row {row.rowNumber}
                        </span>
                        <span className="font-medium text-ink">
                          {row.fullName}
                        </span>
                        <span className="text-ink-2 tabular-nums">
                          {formatDateIST(row.dateOfBirth)}
                        </span>
                        <span className="text-ink-3">{row.locationName}</span>
                      </li>
                    ))}
                  </ul>
                  {preview.totalRows > 8 ? (
                    <p className="px-3 py-2 text-[12px] text-ink-3">
                      Showing the first 8; {preview.rows.length - 8} more ready
                      row{preview.rows.length - 8 === 1 ? "" : "s"} will be
                      imported.
                    </p>
                  ) : null}
                </div>
              ) : null}

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
          <div className="mb-3 flex gap-3 text-[13px] text-ink">
            <input
              id="member-import-attestation"
              type="checkbox"
              checked={attested}
              onChange={(event) => setAttested(event.target.checked)}
              className="h-11 w-11 shrink-0"
            />
            <label htmlFor="member-import-attestation">{IMPORT_ATTESTATION}</label>
          </div>
          <div className="mb-3">
            <Field id="member-import-evidence" label="Evidence reference (optional)">
              {(field) => (
                <Input
                  {...field}
                  type="text"
                  maxLength={500}
                  value={evidenceNote}
                  onChange={(event) => setEvidenceNote(event.target.value)}
                />
              )}
            </Field>
          </div>
          <Button
            type="button"
            variant="primary"
            size="md"
            onClick={commit}
            disabled={busy || !attested}
            className="w-full"
          >
            {busy
              ? "Importing…"
              : `Import ${preview.rows.length} member${
                  preview.rows.length === 1 ? "" : "s"
                } from ${active?.fileName ?? "the selected file"}`}
          </Button>
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
