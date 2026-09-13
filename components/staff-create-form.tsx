"use client";

import Link from "next/link";
import { useState } from "react";
import { Loader2, Save, X } from "lucide-react";
import { createStaffAction } from "@/lib/actions/staff";
import {
  resolveTerm,
  titleCase,
  type TerminologyState,
} from "@/lib/terminology/keys";
import { DateField } from "@/components/ui/DateField";

type Mode = "new" | "existing";

// Same labels/control shape as the sibling "Invite staff" form so the
// same decision is asked the same way on both screens (2026-09-13
// audit R-D6). The coach label still routes through the closed-key
// resolver; Title Case here matches the other three role names.
const ROLE_KEYS = ["coach", "receptionist", "worker", "accountant"] as const;
type StaffType = (typeof ROLE_KEYS)[number];

export function StaffCreateForm({ terminology }: { terminology: TerminologyState }) {
  const [mode, setMode] = useState<Mode>("new");
  const [fullName, setFullName] = useState("");
  const [existingPersonId, setExistingPersonId] = useState("");
  const [staffType, setStaffType] = useState<StaffType>("coach");
  const [employedOn, setEmployedOn] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function roleLabel(key: StaffType): string {
    if (key === "coach") return titleCase(resolveTerm(terminology, "coach", 1));
    if (key === "receptionist") return "Receptionist";
    if (key === "worker") return "Worker";
    return "Accountant";
  }

  function submit() {
    setError(null);
    setPending(true);
    createStaffAction({
      staffType,
      ...(mode === "new" ? { fullName } : { existingPersonId }),
      ...(employedOn ? { employedOn } : {}),
    }).then((result) => {
      setPending(false);
      if (result.kind === "ok") {
        // The form page wraps us; on success, it shows the new
        // staff member. A full page refresh ensures the server
        // list re-renders.
        window.location.assign("/owner/staff");
      } else {
        setError(result.message);
      }
    });
  }

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
        <label className="block mb-4">
          <span className="block text-[12.5px] font-medium mb-1.5">Full name</span>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Rehan Mehta"
            maxLength={200}
            className="w-full rounded-ctl border border-line bg-paper px-3 py-2.5 text-[16px]"
            data-testid="staff-fullName"
          />
        </label>
      ) : (
        <label className="block mb-4">
          <span className="block text-[12.5px] font-medium mb-1.5">Existing person id</span>
          <input
            type="text"
            value={existingPersonId}
            onChange={(e) => setExistingPersonId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            className="w-full rounded-ctl border border-line bg-paper px-3 py-2.5 text-[16px] font-mono"
            data-testid="staff-existingPersonId"
          />
          <span className="block mt-1 text-[12px] text-ink-3">
            Paste the person&apos;s id here. Useful when a member is also being made staff.
          </span>
        </label>
      )}

      <div className="mb-4">
        <span className="block text-[12.5px] font-medium mb-1.5">Role</span>
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
        <label
          htmlFor="staff-employedOn"
          className="block text-[12.5px] font-medium mb-1.5"
        >
          Employed on (optional)
        </label>
        <DateField
          id="staff-employedOn"
          value={employedOn}
          onChange={setEmployedOn}
          data-testid="staff-employedOn"
        />
      </div>

      {error ? (
        <p className="mb-4 text-[13px] text-ink-3" role="alert">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="flex-1 rounded-pill py-4 text-[14.5px] font-semibold text-paper bg-[var(--accent)] disabled:opacity-70 flex items-center justify-center gap-2"
          data-testid="staff-save"
        >
          {pending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {pending ? "Adding…" : "Add staff"}
        </button>
        <Link
          href="/owner/staff"
          className="rounded-pill px-4 py-4 text-[14px] font-medium text-ink-2 bg-deck flex items-center"
        >
          <X size={14} className="mr-1" /> Cancel
        </Link>
      </div>
    </div>
  );
}
