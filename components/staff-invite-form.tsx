"use client";

import { useState } from "react";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { Loader2, Save, X } from "lucide-react";
import { inviteStaffAction } from "@/lib/actions/staff-invitations";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";

type LocationOption = { id: string; name: string };

const ROLE_OPTIONS = [
  { key: "coach", label: "Coach" },
  { key: "receptionist", label: "Receptionist" },
  { key: "worker", label: "Worker" },
  { key: "accountant", label: "Accountant" },
  { key: "manager", label: "Manager" },
] as const;

type InviteRoleKey = (typeof ROLE_OPTIONS)[number]["key"];

export function StaffInviteForm({ locations }: { locations: LocationOption[] }) {
  const [phone, setPhone] = useState("");
  const [fullName, setFullName] = useState("");
  const [roleKey, setRoleKey] = useState<InviteRoleKey>("coach");
  const [locationIds, setLocationIds] = useState<string[]>([]);
  const [scope, setScope] = useState<"selected" | "all" | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Tenant-wide is an explicit choice, never inferred from a blank list.
  const isManager = roleKey === "manager";
  const scopeMissing = scope === null || (scope === "selected" && locationIds.length === 0);

  function toggleLocation(id: string) {
    setLocationIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function submit() {
    if (scopeMissing) return;
    setError(null);
    setPending(true);
    try {
      const result = await inviteStaffAction({
        phone,
        fullName,
        roleKey,
        locationIds: scope === "all" ? [] : locationIds,
        managerAllLocations: isManager && scope === "all",
      });
      if (result.kind === "ok") {
        window.location.assign("/owner/staff/invitations");
      } else {
        setError(result.message);
      }
    } catch {
      setError(
        "The invitation could not be created. Your entries are kept — try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <div>
      <div className="mb-4">
        <Field
          id="invite-phone-field"
          label="Phone number (with country code)"
          description="Country code first. After inviting, generate a login link and share it directly with the person."
        >
          {(field) => (
            <Input
              {...field}
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+919876543210"
              className="font-mono"
              data-testid="invite-phone"
            />
          )}
        </Field>
      </div>
      <div className="mb-4">
        <Field id="invite-name-field" label="Full name">
          {(field) => (
            <Input
              {...field}
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Rehan Mehta"
              maxLength={200}
              data-testid="invite-name"
            />
          )}
        </Field>
      </div>

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

        <fieldset className="mb-4">
          <legend className="mb-1.5 text-[12.5px] font-medium">Access scope</legend>
          <label className="mr-4 inline-flex min-h-11 items-center gap-2">
            <input type="radio" name="access-scope" checked={scope === "selected"} onChange={() => setScope("selected")} />
            Selected facilities
          </label>
          <label className="inline-flex min-h-11 items-center gap-2">
            <input type="radio" name="access-scope" checked={scope === "all"} onChange={() => setScope("all")} />
            Whole academy, including future facilities
          </label>
        </fieldset>

      {locations.length > 0 && scope === "selected" ? (
        <div className="mb-6">
          <span className="block text-[12.5px] font-medium mb-1.5">
            Facilities (choose at least one)
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

      {scopeMissing ? (
        <p
          className="mb-4 text-[13px] text-ink-2"
          role="alert"
          data-testid="invite-manager-facilities-required"
        >
          Choose at least one facility, or explicitly choose the whole academy.
        </p>
      ) : null}

      {!scopeMissing ? (
        <p className="mb-4 text-[13px] text-ink-2" data-testid="invite-scope-summary">
          {ROLE_OPTIONS.find((role) => role.key === roleKey)?.label} — {scope === "all"
            ? "whole academy, including future facilities"
            : locations.filter((location) => locationIds.includes(location.id)).map((location) => location.name).join(", ")}
        </p>
      ) : null}
      {scope === "selected" && !isManager ? (
        <p className="mb-4 text-[13px] text-ink-2">Club-wide records without an assigned site may also be visible.</p>
      ) : null}

      {error ? (
        <p className="mb-4 text-[13px] text-ink-2" role="alert">{error}</p>
      ) : null}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="primary"
          size="lg"
          onClick={submit}
          disabled={pending || scopeMissing}
          className="flex-1"
          data-testid="invite-save"
        >
          {pending ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />}
          {pending ? "Inviting…" : "Create invitation"}
        </Button>
        <Link
          href="/owner/staff/invitations"
          className="inline-flex items-center justify-center rounded-ctl bg-deck px-4 py-3 text-[14px] font-medium text-ink-2"
        >
          <X size={14} className="mr-1" aria-hidden="true" /> Cancel
        </Link>
      </div>
    </div>
  );
}
