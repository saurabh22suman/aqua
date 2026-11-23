"use client";

import { useEffect, useRef, useState } from "react";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { formatPhoneIN } from "@/lib/phone";

// Staff person lookup (India-first simplification, item 6).
//
// A staff record can be linked to an existing person by NAME or PHONE —
// never by pasting a raw person UUID. The list is explicit: nothing is
// auto-selected, and the chosen person is shown in an identity preview with
// a Change action. The backend-D action is injected as `searchCandidates`
// (same agreed shape) so this component owns only presentation/interaction;
// tests mock that boundary.

export type StaffCandidate = {
  personId: string;
  fullName: string;
  phone: string | null;
};

export type StaffCandidateSearch = (
  query: string,
) => Promise<StaffCandidate[]>;

type Status = "idle" | "searching" | "done" | "error";

const MIN_QUERY = 2;

export function StaffPersonPicker({
  searchCandidates,
  selected,
  onSelect,
  disabled = false,
}: {
  searchCandidates: StaffCandidateSearch;
  selected: StaffCandidate | null;
  onSelect: (candidate: StaffCandidate | null) => void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<StaffCandidate[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    // Every dependency change invalidates anything already in flight.
    const requestId = ++seq.current;
    if (selected) {
      setResults([]);
      setStatus("idle");
      setError(null);
      return;
    }
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY) {
      setResults([]);
      setStatus("idle");
      setError(null);
      return;
    }
    // A newer query must never leave the previous rows clickable.
    setResults([]);
    setStatus("searching");
    setError(null);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const found = await searchCandidates(trimmed);
          // Stale-result guard: an older response never replaces a newer one.
          if (requestId !== seq.current) return;
          setResults(found);
          setStatus("done");
        } catch {
          if (requestId !== seq.current) return;
          setResults([]);
          setStatus("error");
          setError("Could not search people. Check the connection and try again.");
        }
      })();
    }, 250);
    return () => {
      clearTimeout(timer);
      // Also invalidate on unmount/selection so a late response is ignored.
      seq.current += 1;
    };
  }, [query, selected, searchCandidates]);

  if (selected) {
    return (
      <div
        className="rounded-ctl border border-line bg-paper p-4"
        data-testid="staff-person-preview"
      >
        <p className="text-[14px] font-medium text-ink">{selected.fullName}</p>
        <p className="mt-0.5 text-[12.5px] text-ink-3">
          {selected.phone ? formatPhoneIN(selected.phone) : "No phone on file"}
        </p>
        <p className="mt-1 text-[12px] text-ink-3">
          This existing person will be linked to the staff record. No login is
          created by adding the record.
        </p>
        <Button
          type="button"
          variant="secondary"
          size="md"
          className="mt-3"
          disabled={disabled}
          onClick={() => {
            onSelect(null);
            setQuery("");
            setResults([]);
            setStatus("idle");
          }}
        >
          Change person
        </Button>
      </div>
    );
  }

  return (
    <div>
      <Field
        id="staff-person-query"
        label="Find a person by name or phone"
        description="Search the academy's people. Pick the exact person before adding the staff record."
      >
        {(field) => (
          <Input
            {...field}
            type="search"
            role="searchbox"
            value={query}
            disabled={disabled}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Asha Rao or 90000 00101"
            maxLength={200}
            autoComplete="off"
          />
        )}
      </Field>

      {status === "idle" ? (
        <p className="mt-2 text-[12.5px] text-ink-3">
          Type at least {MIN_QUERY} characters to search.
        </p>
      ) : null}
      {status === "searching" ? (
        <p className="mt-2 text-[12.5px] text-ink-3" role="status">
          Searching people…
        </p>
      ) : null}
      {status === "error" ? (
        <p className="mt-2 text-[12.5px] text-ink-2" role="alert">
          {error}
        </p>
      ) : null}
      {status === "done" && results.length === 0 ? (
        <p className="mt-2 text-[12.5px] text-ink-3">
          No matching person. Check the spelling or the phone number.
        </p>
      ) : null}

      {results.length > 0 ? (
        <ul className="mt-2 divide-y divide-line rounded-ctl border border-line">
          {results.map((candidate) => (
            <li key={candidate.personId}>
              <button
                type="button"
                disabled={disabled}
                onClick={() => onSelect(candidate)}
                className="flex min-h-11 w-full flex-wrap items-baseline justify-between gap-2 px-4 py-3 text-left hover:bg-deck disabled:opacity-50"
              >
                <span className="text-[14px] font-medium text-ink">
                  {candidate.fullName}
                </span>
                <span className="text-[12.5px] text-ink-3">
                  {candidate.phone ? formatPhoneIN(candidate.phone) : "No phone"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
