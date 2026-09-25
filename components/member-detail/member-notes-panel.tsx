"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createMemberNoteAction,
  deleteMemberNoteAction,
  listMemberNotesAction,
  updateMemberNoteAction,
} from "@/lib/actions/member-notes";
import type { MemberNoteRow } from "@/lib/services/member-notes";
import { formatDateTimeIST } from "@/lib/time/tz";

// U-03 — member notes. Staff-internal; create, edit in place, and
// archive (soft delete). The list reloads from the action after every
// mutation so the surface never shows optimistic state the database
// did not accept.

const inputClass =
  "w-full min-h-11 rounded-ctl border border-line bg-paper px-3 py-2 text-[16px] text-ink focus:border-[var(--accent-strong)] focus:outline-none";

export function MemberNotesPanel({
  memberId,
  canWrite,
}: {
  memberId: string;
  canWrite: boolean;
}) {
  const [notes, setNotes] = useState<MemberNoteRow[] | null>(null);
  const [body, setBody] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setNotes(await listMemberNotesAction(memberId));
  }, [memberId]);

  useEffect(() => {
    void load();
  }, [load]);

  function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setBusy(true);
    setMessage(null);
    void (async () => {
      const result = await fn();
      setMessage(result.ok ? "Saved." : result.error);
      if (result.ok) await load();
      setBusy(false);
    })();
  }

  return (
    <section className="mt-4 rounded-card border border-line bg-paper p-4">
      <h2 className="font-display text-[15px] font-semibold">Notes</h2>
      <p className="mt-1 text-[12.5px] text-ink-3">
        Internal notes for staff — they are never shown on the parent link.
      </p>

      {canWrite ? (
        <div className="mt-3">
          <label className="block">
            <span className="mb-0.5 block text-[11px] text-ink-3">
              Add a note
            </span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              maxLength={4000}
              className={inputClass}
              placeholder="Called about the missed session…"
            />
          </label>
          <button
            type="button"
            disabled={busy || body.trim().length === 0}
            onClick={() =>
              run(async () => {
                const result = await createMemberNoteAction({ memberId, body });
                if (result.ok) setBody("");
                return result;
              })
            }
            className="mt-2 min-h-[44px] rounded-pill bg-[var(--accent-strong)] px-5 text-[13px] font-semibold text-paper disabled:opacity-60"
          >
            {busy ? "Saving…" : "Add note"}
          </button>
        </div>
      ) : null}

      {notes === null ? (
        <p className="mt-3 text-[13px] text-ink-3">Loading notes…</p>
      ) : notes.length === 0 ? (
        <p className="mt-3 text-[13px] text-ink-3">
          No notes on file for this member yet.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {notes.map((note) => (
            <li key={note.id} className="rounded-ctl border border-line p-3">
              {editingId === note.id ? (
                <div>
                  <textarea
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    rows={3}
                    maxLength={4000}
                    className={inputClass}
                  />
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      disabled={busy || editBody.trim().length === 0}
                      onClick={() =>
                        run(async () => {
                          const result = await updateMemberNoteAction({
                            noteId: note.id,
                            body: editBody,
                          });
                          if (result.ok) setEditingId(null);
                          return result;
                        })
                      }
                      className="min-h-[44px] rounded-pill bg-[var(--accent-strong)] px-4 text-[13px] font-semibold text-paper disabled:opacity-60"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="min-h-[44px] rounded-pill border border-line px-4 text-[13px] text-ink-2"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="whitespace-pre-wrap text-[13.5px] text-ink">
                    {note.body}
                  </p>
                  <p className="mt-1 text-[11.5px] text-ink-3">
                    {note.authorName ?? "Unknown user"} ·{" "}
                    {formatDateTimeIST(note.createdAt)}
                    {note.edited ? " · edited" : ""}
                  </p>
                  {canWrite ? (
                    <div className="mt-1.5 flex gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setEditingId(note.id);
                          setEditBody(note.body);
                        }}
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-pill border border-line px-3 py-1 text-[12px] text-ink-2"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          run(() => deleteMemberNoteAction(note.id))
                        }
                        className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-pill border border-line px-3 py-1 text-[12px] text-ink-3"
                      >
                        Archive
                      </button>
                    </div>
                  ) : null}
                </>
              )}
            </li>
          ))}
        </ul>
      )}

      {message ? (
        <p role="status" className="mt-2 text-[12px] text-ink-2">
          {message}
        </p>
      ) : null}
    </section>
  );
}
