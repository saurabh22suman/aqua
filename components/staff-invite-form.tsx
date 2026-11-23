"use client";

import { useRef, useState } from "react";
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
  const [fieldErrors, setFieldErrors] = useState<{
    phone?: string;
    fullName?: string;
  }>({});
  const phoneRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

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
    // A disabled action with no explanation is a dead end. Validate here,
    // put the message beside the field and take the focus there, so a
    // keyboard or screen-reader user is never left guessing.
    const nextErrors: { phone?: string; fullName?: string } = {};
    if (phone.trim().length === 0) {
      nextErrors.phone = "Enter the staff member's phone number.";
    }
    if (fullName.trim().length === 0) {
      nextErrors.fullName = "Enter the staff member's full name.";
    }
    if (Object.keys(nextErrors).length > 0) {
      setFieldErrors(nextErrors);
      if (nextErrors.phone) phoneRef.current?.focus();
      else nameRef.current?.focus();
      return;
    }
    setFieldErrors({});
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
          error={fieldErrors.phone}
          required
        >
          {(field) => (
            <Input
              {...field}
              ref={phoneRef}
              type="tel"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                if (fieldErrors.phone) {
                  setFieldErrors((prev) => ({ ...prev, phone: undefined }));
                }
              }}
              placeholder="+919876543210"
              className="font-mono"
              data-testid="invite-phone"
            />
          )}
        </Field>
      </div>
      <div className="mb-4">
        <Field
          id="invite-name-field"
          label="Full name"
          error={fieldErrors.fullName}
          required
        >
          {(field) => (
            <Input
              {...field}
              ref={nameRef}
              type="text"
              value={fullName}
              onChange={(e) => {
                setFullName(e.target.value);
                if (fieldErrors.fullName) {
                  setFieldErrors((prev) => ({ ...prev, fullName: undefined }));
                }
              }}
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
          className="mb-4 text-[13px] text-ink-3"
          data-testid="invite-manager-facilities-required"
        >
          Choose selected facilities or the whole academy to continue.
        </p>
      ) : null}

      <section aria-label="Invitation review" className="owner-work-panel mb-4">
        <h2 className="text-sm font-semibold">Review invitation</h2>
        {fullName.trim() || phone.trim() ? <p className="mt-1 break-words text-sm">{[fullName.trim(), phone.trim()].filter(Boolean).join(" · ")}</p> : null}
        {scopeMissing ? <p className="mt-1 text-sm text-ink-2">{ROLE_OPTIONS.find(role => role.key === roleKey)?.label}</p> : (
          <p className="mt-1 text-sm text-ink-2" data-testid="invite-scope-summary">
            {ROLE_OPTIONS.find(role => role.key === roleKey)?.label} — {scope === "all"
              ? "whole academy, including future facilities"
              : locations.filter(location => locationIds.includes(location.id)).map(location => location.name).join(", ")}
          </p>
        )}
      </section>
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
