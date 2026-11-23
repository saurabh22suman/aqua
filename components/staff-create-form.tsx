"use client";

import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { useState } from "react";
import { Loader2, Save, X } from "lucide-react";
import { createStaffAction } from "@/lib/actions/staff";
import {
  resolveTerm,
  titleCase,
  type TerminologyState,
} from "@/lib/terminology/keys";
import { DateField } from "@/components/ui/DateField";
import {
  StaffPersonPicker,
  type StaffCandidate,
  type StaffCandidateSearch,
} from "@/components/staff-person-picker";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";

type Mode = "new" | "existing";

// Stable fallback (never recreated per render). It fails honestly until the
// backend-D candidate search is wired; it never returns invented people.
const unavailableCandidateSearch: StaffCandidateSearch = async () => {
  throw new Error("staff candidate search not wired");
};

// Roster types classify staff records. Account permissions are assigned through invitations.
const ROLE_KEYS = ["coach", "receptionist", "worker", "accountant"] as const;
type StaffType = (typeof ROLE_KEYS)[number];

export function StaffCreateForm({
  terminology,
  searchCandidates,
}: {
  terminology: TerminologyState;
  /** Backend-D staff-candidate search; injected at the page boundary. */
  searchCandidates?: StaffCandidateSearch;
}) {
  const [mode, setMode] = useState<Mode>("new");
  const [fullName, setFullName] = useState("");
  const [selectedPerson, setSelectedPerson] = useState<StaffCandidate | null>(
    null,
  );
  const [staffType, setStaffType] = useState<StaffType>("coach");
  const [employedOn, setEmployedOn] = useState("");
  const [employedOnValid, setEmployedOnValid] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function roleLabel(key: StaffType): string {
    if (key === "coach") return titleCase(resolveTerm(terminology, "coach", 1));
    if (key === "receptionist") return "Receptionist";
    if (key === "worker") return "Worker";
    return "Accountant";
  }

  async function submit() {
    if (!employedOnValid) return;
    setError(null);
    setPending(true);
    try {
      const result = await createStaffAction({
        staffType,
        ...(mode === "new"
          ? { fullName }
          : { existingPersonId: selectedPerson?.personId ?? "" }),
        ...(employedOn ? { employedOn } : {}),
      });
      if (result.kind === "ok") {
        // The form page wraps us; on success, it shows the new
        // staff member. A full page refresh ensures the server
        // list re-renders.
        window.location.assign("/owner/staff");
      } else {
        setError(result.message);
      }
    } catch {
      setError(
        "The staff record could not be saved. Your entries are kept — try again.",
      );
    } finally {
      setPending(false);
    }
  }

  const blockedReason =
    mode === "existing" && selectedPerson === null
      ? "Choose an existing person to continue."
      : mode === "new" && fullName.trim().length === 0
        ? "Enter the person's full name to continue."
        : null;

  return (
    <div>
      <div className="grid grid-cols-2 gap-2 mb-4" data-testid="staff-mode">
        <button
          type="button"
          onClick={() => setMode("new")}
          aria-pressed={mode === "new"}
          className={`min-h-[44px] rounded-ctl border px-3 py-2 text-[13.5px] font-medium ${
            mode === "new" ? "border-ink bg-paper" : "border-line bg-paper text-ink-3"
          }`}
        >
          New person
        </button>
        <button
          type="button"
          onClick={() => setMode("existing")}
          aria-pressed={mode === "existing"}
          className={`min-h-[44px] rounded-ctl border px-3 py-2 text-[13.5px] font-medium ${
            mode === "existing" ? "border-ink bg-paper" : "border-line bg-paper text-ink-3"
          }`}
        >
          Existing person
        </button>
      </div>

      {mode === "new" ? (
        <div className="mb-4">
          <Field id="staff-fullName-field" label="Full name">
            {(field) => (
              <Input
                {...field}
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Rehan Mehta"
                maxLength={200}
                data-testid="staff-fullName"
              />
            )}
          </Field>
        </div>
      ) : (
        <div className="mb-4">
          <StaffPersonPicker
            searchCandidates={searchCandidates ?? unavailableCandidateSearch}
            selected={selectedPerson}
            onSelect={setSelectedPerson}
            disabled={pending}
          />
        </div>
      )}

      <div className="mb-4">
        <span className="block text-[12.5px] font-medium mb-1.5">Staff type</span>
        <div className="grid grid-cols-2 gap-2" data-testid="staff-type">
          {ROLE_KEYS.map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setStaffType(key)}
              aria-pressed={staffType === key}
              className={`min-h-[44px] rounded-ctl border px-3 py-2 text-[13.5px] font-medium ${
                staffType === key
                  ? "border-ink bg-paper text-ink"
                  : "border-line bg-paper text-ink-3"
              }`}
            >
              {roleLabel(key)}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-6">
        <Field id="staff-employedOn" label="Employed on (optional)">
          {(field) => (
            <DateField
              {...field}
              value={employedOn}
              onChange={setEmployedOn}
              onValidityChange={setEmployedOnValid}
              data-testid="staff-employedOn"
            />
          )}
        </Field>
      </div>

      {!employedOnValid ? (
        <p className="mb-4 text-[13px] text-ink-2" role="alert">
          Enter a complete date as dd/mm/yyyy, or leave it blank.
        </p>
      ) : null}

      {error ? (
        <p className="mb-4 text-[13px] text-ink-2" role="alert">
          {error}
        </p>
      ) : null}

      {blockedReason ? (
        <p className="mb-3 text-[12.5px] text-ink-3" role="status">
          {blockedReason}
        </p>
      ) : null}

      {(mode === "new" ? fullName.trim() : selectedPerson?.fullName) ? (
        <section aria-label="Review staff record" className="owner-work-panel mb-3">
          <h2 className="text-sm font-semibold">{mode === "new" ? "Create a new person" : "Use an existing person"}</h2>
          <p className="mt-1 break-words">{mode === "new" ? fullName.trim() : selectedPerson?.fullName}</p>
          <p className="text-sm text-ink-2">{roleLabel(staffType)}</p>
        </section>
      ) : null}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="primary"
          size="lg"
          onClick={submit}
          disabled={
            pending ||
            !employedOnValid ||
            (mode === "existing" && selectedPerson === null) ||
            (mode === "new" && fullName.trim().length === 0)
          }
          className="flex-1"
          data-testid="staff-save"
        >
          {pending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
          {pending ? "Adding…" : "Add staff record"}
        </Button>
        <Link
          href="/owner/staff"
          className="inline-flex items-center justify-center rounded-ctl bg-deck px-4 py-3 text-[14px] font-medium text-ink-2"
        >
          <X size={14} className="mr-1" aria-hidden="true" /> Cancel
        </Link>
      </div>
    </div>
  );
}
