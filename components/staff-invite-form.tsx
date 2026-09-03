"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Save, X } from "lucide-react";
import { inviteStaffAction } from "@/lib/actions/staff-invitations";

type LocationOption = { id: string; name: string };

const ROLE_OPTIONS = [
  { key: "coach", label: "Coach" },
  { key: "receptionist", label: "Receptionist" },
] as const;

export function StaffInviteForm({ locations }: { locations: LocationOption[] }) {
  const [phone, setPhone] = useState("");
  const [fullName, setFullName] = useState("");
  const [roleKey, setRoleKey] = useState<"coach" | "receptionist">("coach");
  const [locationIds, setLocationIds] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleLocation(id: string) {
    setLocationIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function submit() {
    setError(null);
    setPending(true);
    inviteStaffAction({
      phone,
      fullName,
      roleKey,
      locationIds,
    }).then((result) => {
      setPending(false);
      if (result.kind === "ok") {
        window.location.assign("/owner/staff/invitations");
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <div>
      <label className="block mb-4">
        <span className="block text-[12.5px] font-medium mb-1.5">Phone (E.164)</span>
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+919876543210"
          className="w-full rounded-ctl border border-line bg-paper px-3 py-2.5 text-[16px] font-mono"
          data-testid="invite-phone"
        />
        <span className="block mt-1 text-[12px] text-ink-3">
          Country code first. The invitee signs in with the same phone.
        </span>
      </label>
      <label className="block mb-4">
        <span className="block text-[12.5px] font-medium mb-1.5">Full name</span>
        <input
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Rehan Mehta"
          maxLength={200}
          className="w-full rounded-ctl border border-line bg-paper px-3 py-2.5 text-[16px]"
          data-testid="invite-name"
        />
      </label>

      <div className="mb-4">
        <span className="block text-[12.5px] font-medium mb-1.5">Role</span>
        <div className="grid grid-cols-2 gap-2" data-testid="invite-role">
          {ROLE_OPTIONS.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRoleKey(r.key)}
              aria-pressed={roleKey === r.key}
              className={`min-h-[44px] rounded-ctl border px-3 py-2.5 text-[14px] font-medium ${
                roleKey === r.key ? "border-ink bg-paper" : "border-line bg-paper text-ink-3"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {locations.length > 0 ? (
        <div className="mb-6">
          <span className="block text-[12.5px] font-medium mb-1.5">
            Location scope (empty = all locations)
          </span>
          <div className="grid grid-cols-2 gap-2">
            {locations.map((l) => {
              const on = locationIds.includes(l.id);
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => toggleLocation(l.id)}
                  aria-pressed={on}
                  className={`min-h-[44px] rounded-ctl border px-3 py-2.5 text-[13.5px] ${
                    on ? "border-ink bg-paper text-ink" : "border-line bg-paper text-ink-3"
                  }`}
                >
                  {l.name}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="mb-4 text-[13px] text-late" role="alert">{error}</p>
      ) : null}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="flex-1 rounded-pill py-4 text-[14.5px] font-semibold text-paper bg-[var(--accent)] disabled:opacity-70 flex items-center justify-center gap-2"
          data-testid="invite-save"
        >
          {pending ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {pending ? "Inviting…" : "Send invite"}
        </button>
        <Link
          href="/owner/staff/invitations"
          className="rounded-pill px-4 py-4 text-[14px] font-medium text-ink-2 bg-deck flex items-center"
        >
          <X size={14} className="mr-1" /> Cancel
        </Link>
      </div>
    </div>
  );
}
