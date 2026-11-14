"use client";

import { Button } from "@/components/ui/Button";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { useState } from "react";
import {
  createLocationAction,
  listAdminLocationsAction,
  updateLocationAction,
} from "@/lib/actions/locations";
import type { LocationAdminRow } from "@/lib/services/locations";
import { BusinessHoursEditor } from "@/components/settings/business-hours-editor";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";

// U-07 — the location editor. Each location is one card: name, kind
// and address, with the business-hours editor beneath. For a
// single-location tenant there is no switcher and no "All locations"
// concept — just the academy's own details and a quiet path to add a
// second site.


const KINDS: Array<{ value: "club" | "cafe" | "mixed"; label: string }> = [
  { value: "club", label: "Club / academy" },
  { value: "cafe", label: "Café" },
  { value: "mixed", label: "Mixed (club + café)" },
];

type Address = LocationAdminRow["address"];

// Dot SS-05 — a thrown action means the response was lost, not that the
// server refused the write. Keep the draft and say only what is known.
const UPDATE_UNCERTAIN =
  "Could not confirm whether this location was saved. Check the location details before trying again.";
const CREATE_UNCERTAIN =
  "Could not confirm whether this location was created. Check the location list before trying again.";

export function LocationManager({
  initial,
  canWrite,
}: {
  initial: LocationAdminRow[];
  canWrite: boolean;
}) {
  const [locations, setLocations] = useState(initial);
  const [message, setMessage] = useState<string | null>(null);

  async function reload() {
    setLocations(await listAdminLocationsAction());
  }

  return (
    <div className="mt-4 space-y-4">
      {locations.map((location) => (
        <LocationCard
          key={location.id}
          location={location}
          canWrite={canWrite}
          onSaved={async (text) => {
            setMessage(text);
            await reload();
          }}
        />
      ))}

      {canWrite ? (
        <section className="rounded-card border border-line bg-paper p-4 sm:p-5">
          <h2 className="font-display text-[16px] font-semibold">
            {locations.length > 1 ? "Add another location" : "Add a second location"}
          </h2>
          <p className="mt-1 text-[12.5px] text-ink-3">
            A second site lets you switch between them, with per-site rosters
            and per-site reports.
          </p>
          <CreateLocationForm
            onCreated={async (text) => {
              setMessage(text);
              await reload();
            }}
          />
        </section>
      ) : null}

      {message ? (
        <p role="status" className="text-[12px] text-ink-2">
          {message}
        </p>
      ) : null}
    </div>
  );
}

function LocationCard({
  location,
  canWrite,
  onSaved,
}: {
  location: LocationAdminRow;
  canWrite: boolean;
  onSaved: (message: string) => void;
}) {
  const [name, setName] = useState(location.name);
  const [kind, setKind] = useState<LocationAdminRow["kind"]>(location.kind);
  const [address, setAddress] = useState<Address>(location.address ?? {});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function setField(field: keyof NonNullable<Address>, value: string) {
    setAddress((current) => ({ ...(current ?? {}), [field]: value }));
  }

  return (
    <section className="rounded-card border border-line bg-paper px-4 py-2 sm:px-5">
    <details>
      <summary className="flex min-h-11 cursor-pointer flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-[16px] font-semibold">
          {location.name}
        </h2>
        <span className="flex items-center gap-2">
        {location.isPrimary ? (
          <span className="rounded-pill bg-water-soft px-2.5 py-0.5 text-[11px] font-medium text-water">
            Primary
          </span>
        ) : null}
        <span className="text-[12px] text-ink-3" aria-hidden="true">Details ▾</span>
        </span>
      </summary>

      <div className="mt-3 grid items-start gap-4 lg:grid-cols-2">
        <div>
          <h3 className="font-display text-[14px] font-semibold text-ink">
            Site details
          </h3>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-0.5 block text-[11px] text-ink-3">Name</span>
              <Input
                value={name}
                disabled={!canWrite}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="mb-0.5 block text-[11px] text-ink-3">Kind</span>
              <Select
                value={kind}
                disabled={!canWrite}
                onChange={(e) => setKind(e.target.value as LocationAdminRow["kind"])}
              >
                {KINDS.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </Select>
            </label>
          </div>

          {canWrite ? (
            <>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                {(
                  [
                    ["line1", "Address line 1"],
                    ["line2", "Address line 2"],
                    ["city", "City"],
                    ["state", "State"],
                    ["pincode", "PIN code"],
                  ] as Array<[keyof NonNullable<Address>, string]>
                ).map(([field, label]) => (
                  <label key={field} className="block">
                    <span className="mb-0.5 block text-[11px] text-ink-3">
                      {label}
                    </span>
                    <Input
                      value={(address ?? {})[field] ?? ""}
                      onChange={(e) => setField(field, e.target.value)}
                    />
                  </label>
                ))}
              </div>
              <Button
                variant="primary"
                size="md"
                className="mt-3"
                type="button"
                disabled={busy || name.trim().length === 0}
                onClick={() => {
                  setBusy(true);
                  setMessage(null);
                  void (async () => {
                    try {
                      const result = await updateLocationAction({
                        locationId: location.id,
                        name,
                        kind,
                        address,
                      });
                      setMessage(result.ok ? "Saved." : result.error);
                      if (result.ok) onSaved("Location saved.");
                    } catch {
                      setMessage(UPDATE_UNCERTAIN);
                    } finally {
                      setBusy(false);
                    }
                  })();
                }}
              >
                {busy ? "Saving…" : "Save location"}
              </Button>
            </>
          ) : null}

          {message ? (
            <p role="status" className="mt-2 text-[12px] text-ink-2">
              {message}
            </p>
          ) : null}
        </div>

        <div>
          <h3 className="font-display text-[14px] font-semibold text-ink">
            Weekly hours
          </h3>
          <BusinessHoursEditor locationId={location.id} canWrite={canWrite} />
        </div>
      </div>
    </details>
      <Link href={`/owner/settings/locations/${location.id}`} aria-label={`Financial settings for ${location.name}`} className="inline-flex min-h-12 items-center text-[14px] text-[var(--accent-ink)] underline underline-offset-2">Financial settings</Link>
    </section>
  );
}

function CreateLocationForm({
  onCreated,
}: {
  onCreated: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"club" | "cafe" | "mixed">("club");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-3 inline-flex min-h-[44px] items-center gap-2 rounded-pill border border-line bg-paper px-5 text-[13px] font-medium text-ink"
      >
        <OwnerIcon name="plus" size={18} />
        Add location
      </button>
    );
  }

  return (
    <div className="mt-3">
      <label className="block">
        <span className="mb-0.5 block text-[11px] text-ink-3">
          New location name
        </span>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}

          placeholder="Andheri West"
        />
      </label>
      <label className="mt-2 block">
        <span className="mb-0.5 block text-[11px] text-ink-3">Kind</span>
        <Select
          value={kind}
          onChange={(e) => setKind(e.target.value as "club" | "cafe" | "mixed")}

        >
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </Select>
      </label>
      <div className="mt-2 flex gap-2">
        <Button
            variant="primary"
            size="md"
            type="button"
          disabled={busy || name.trim().length === 0}
          onClick={() => {
            setBusy(true);
            setMessage(null);
            void (async () => {
              try {
                const result = await createLocationAction({ name, kind });
                if (result.ok) {
                  onCreated("Location added.");
                  setName("");
                  setOpen(false);
                } else {
                  setMessage(result.error);
                }
              } catch {
                setMessage(CREATE_UNCERTAIN);
              } finally {
                setBusy(false);
              }
            })();
          }}
          >
          {busy ? "Saving…" : "Create"}
        </Button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="min-h-[44px] rounded-pill border border-line px-5 text-[13px] text-ink-2"
        >
          Cancel
        </button>
      </div>
      {message ? (
        <p role="status" className="mt-2 text-[12px] text-ink-2">
          {message}
        </p>
      ) : null}
    </div>
  );
}
