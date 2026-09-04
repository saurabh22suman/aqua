"use client";

import Link from "next/link";
import { useState } from "react";
import { Loader2, Save, X } from "lucide-react";
import { createStaffAction } from "@/lib/actions/staff";

type Mode = "new" | "existing";

export function StaffCreateForm() {
  const [mode, setMode] = useState<Mode>("new");
  const [fullName, setFullName] = useState("");
  const [existingPersonId, setExistingPersonId] = useState("");
  const [staffType, setStaffType] = useState<"coach" | "receptionist" | "worker" | "accountant">("coach");
  const [employedOn, setEmployedOn] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
            className="w-full rounded-ctl border border-line bg-paper px-3 py-2.5 text-[14px] font-mono"
            data-testid="staff-existingPersonId"
          />
          <span className="block mt-1 text-[12px] text-ink-3">
            Paste the person&apos;s id here. Useful when a member is also being made staff.
          </span>
        </label>
      )}

      <label className="block mb-4">
        <span className="block text-[12.5px] font-medium mb-1.5">Role</span>
        <select
          value={staffType}
          onChange={(e) => setStaffType(e.target.value as typeof staffType)}
          className="w-full rounded-ctl border border-line bg-paper px-3 py-2.5 text-[16px]"
          data-testid="staff-type"
        >
          <option value="coach">Coach</option>
          <option value="receptionist">Receptionist</option>
          <option value="worker">Worker</option>
          <option value="accountant">Accountant</option>
        </select>
      </label>

      <label className="block mb-6">
        <span className="block text-[12.5px] font-medium mb-1.5">Employed on (optional)</span>
        <input
          type="date"
          value={employedOn}
          onChange={(e) => setEmployedOn(e.target.value)}
          className="w-full rounded-ctl border border-line bg-paper px-3 py-2.5 text-[16px]"
          data-testid="staff-employedOn"
        />
      </label>

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
