"use client";

import { useState } from "react";
import {
  createLocationAction,
  listAdminLocationsAction,
  updateLocationAction,
} from "@/lib/actions/locations";
import type { LocationAdminRow } from "@/lib/services/locations";
import { BusinessHoursEditor } from "@/components/settings/business-hours-editor";

// U-07 — the location editor. Each location is one card: name, kind
// and address, with the business-hours editor beneath. For a
// single-location tenant there is no switcher and no "All locations"
// concept — just the academy's own details and a quiet path to add a
// second site.

const inputClass =
  "w-full rounded-ctl border border-line bg-paper px-3 py-2 text-[16px] text-ink focus:border-[var(--accent)] focus:outline-none";

const KINDS: Array<{ value: "club" | "cafe" | "mixed"; label: string }> = [
  { value: "club", label: "Club / academy" },
  { value: "cafe", label: "Café" },
  { value: "mixed", label: "Mixed (club + café)" },
];

type Address = LocationAdminRow["address"];

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
        <section className="rounded-card border border-line bg-paper p-4">
          <h2 className="font-display text-[15px] font-semibold">
            {locations.length > 1 ? "Add another location" : "Add a second location"}
          </h2>
          <p className="mt-1 text-[12.5px] text-ink-3">
            A second site turns on the location concept across Aqua — the
            switcher, per-site rosters and per-site reports.
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
    <section className="rounded-card border border-line bg-paper p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-[15px] font-semibold">
          {location.name}
        </h2>
        {location.isPrimary ? (
          <span className="rounded-pill bg-water-soft px-2.5 py-0.5 text-[11px] font-medium text-water">
            Primary
          </span>
        ) : null}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-0.5 block text-[11px] text-ink-3">Name</span>
          <input
            value={name}
            disabled={!canWrite}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="block">
          <span className="mb-0.5 block text-[11px] text-ink-3">Kind</span>
          <select
            value={kind}
            disabled={!canWrite}
            onChange={(e) => setKind(e.target.value as LocationAdminRow["kind"])}
            className={inputClass}
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
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
                <input
                  value={(address ?? {})[field] ?? ""}
                  onChange={(e) => setField(field, e.target.value)}
                  className={inputClass}
                />
              </label>
            ))}
          </div>
          <button
            type="button"
            disabled={busy || name.trim().length === 0}
            onClick={() => {
              setBusy(true);
              setMessage(null);
              void (async () => {
                const result = await updateLocationAction({
                  locationId: location.id,
                  name,
                  kind,
                  address,
                });
                setMessage(result.ok ? "Saved." : result.error);
                if (result.ok) onSaved("Location saved.");
                setBusy(false);
              })();
            }}
            className="mt-3 min-h-[44px] rounded-pill bg-[var(--accent)] px-5 text-[13px] font-semibold text-paper disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save location"}
          </button>
        </>
      ) : null}

      {message ? (
        <p role="status" className="mt-2 text-[12px] text-ink-2">
          {message}
        </p>
      ) : null}

      <BusinessHoursEditor locationId={location.id} canWrite={canWrite} />
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
        className="mt-3 min-h-[44px] rounded-pill border border-line bg-paper px-5 text-[13px] font-medium text-ink"
      >
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
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
          placeholder="Andheri West"
        />
      </label>
      <label className="mt-2 block">
        <span className="mb-0.5 block text-[11px] text-ink-3">Kind</span>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as "club" | "cafe" | "mixed")}
          className={inputClass}
        >
          {KINDS.map((k) => (
            <option key={k.value} value={k.value}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={busy || name.trim().length === 0}
          onClick={() => {
            setBusy(true);
            setMessage(null);
            void (async () => {
              const result = await createLocationAction({ name, kind });
              if (result.ok) {
                onCreated("Location added.");
                setName("");
                setOpen(false);
              } else {
                setMessage(result.error);
              }
              setBusy(false);
            })();
          }}
          className="min-h-[44px] rounded-pill bg-[var(--accent)] px-5 text-[13px] font-semibold text-paper disabled:opacity-60"
        >
          {busy ? "Saving…" : "Create"}
        </button>
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
