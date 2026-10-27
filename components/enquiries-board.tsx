"use client";

import { useState } from "react";
import Link from "next/link";
import { createEnquiryAction } from "@/lib/actions/enquiries";
import type { EnquiryRow } from "@/lib/services/enquiries";
import { ENQUIRY_STAGE_LABELS } from "@/lib/enquiry-stage-graph";
import {
  StatusBadge,
  ENQUIRY_STAGE_TONE,
} from "@/components/ui/StatusBadge";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { formatPhoneIN } from "@/lib/phone";

const SOURCES = ["walk-in", "phone", "referral", "online", "other"] as const;

/**
 * Which surface this board is serving.
 *
 * `front-desk` — reception's own capture-first board. This is the
 * default so the reception journey is unchanged.
 *
 * `oversight` — the owner's board. Owner oversight leads (the current
 * enquiries first, with their drill-down) and the routine capture is
 * secondary, available when the owner is covering reception.
 */
export type EnquiriesBoardVariant = "front-desk" | "oversight";

export function EnquiriesBoard({
  initialEnquiries,
  detailHrefPrefix = "/owner/enquiries",
  locations,
  canWrite,
  variant = "front-desk",
}: {
  initialEnquiries: EnquiryRow[];
  detailHrefPrefix?: string;
  // R04 (2026-10-13 role-workflow audit) — capture requires a site;
  // the caller's allowed locations come from the server page.
  locations: Array<{ id: string; name: string }>;
  canWrite: boolean;
  variant?: EnquiriesBoardVariant;
}) {
  const [enquiries, setEnquiries] = useState(initialEnquiries);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState<(typeof SOURCES)[number]>("walk-in");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(variant === "front-desk");

  async function submit() {
    if (!fullName.trim() || !locationId) return;
    setBusy(true);
    setError(null);
    try {
      const enquiry = await createEnquiryAction({
        fullName: fullName.trim(),
        phone: phone.trim() || undefined,
        source,
        locationId,
      });
      setEnquiries((e) => [enquiry, ...e]);
      setFullName("");
      setPhone("");
    } catch {
      // R07 — a refused capture shows an inline error; the typed
      // details stay in the controlled fields.
      setError("Could not save the enquiry. Check the site and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!canWrite || locations.length === 0) {
    return (
      <div className="space-y-4">
        <p className="rounded-card border border-line bg-paper px-3.5 py-3 text-[12.5px] text-ink-3">
          {locations.length === 0
            ? "No site is configured yet — ask the owner to add one before capturing enquiries."
            : "Your role can view enquiries but not capture them."}
        </p>
        <EnquiryList
          enquiries={enquiries}
          detailHrefPrefix={detailHrefPrefix}
        />
      </div>
    );
  }

  const capture = (
    <CaptureCard
      fullName={fullName}
      phone={phone}
      source={source}
      locationId={locationId}
      locations={locations}
      error={error}
      busy={busy}
      onFullName={setFullName}
      onPhone={setPhone}
      onSource={setSource}
      onLocationId={setLocationId}
      onSubmit={() => void submit()}
    />
  );

  if (variant === "oversight") {
    // Owner oversight leads; the routine capture stays secondary.
    return (
      <div className="space-y-4">
        <EnquiryList enquiries={enquiries} detailHrefPrefix={detailHrefPrefix} />
        <div>
          <Button
            variant="secondary"
            size="md"
            onClick={() => setCaptureOpen((open) => !open)}
            aria-expanded={captureOpen}
            aria-controls="enquiry-capture"
          >
            {captureOpen
              ? "Close enquiry capture"
              : "Capture an enquiry when covering reception"}
          </Button>
          {captureOpen ? (
            <div id="enquiry-capture" className="mt-3">
              {capture}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {capture}
      <EnquiryList enquiries={enquiries} detailHrefPrefix={detailHrefPrefix} />
    </div>
  );
}

function CaptureCard({
  fullName,
  phone,
  source,
  locationId,
  locations,
  error,
  busy,
  onFullName,
  onPhone,
  onSource,
  onLocationId,
  onSubmit,
}: {
  fullName: string;
  phone: string;
  source: (typeof SOURCES)[number];
  locationId: string;
  locations: Array<{ id: string; name: string }>;
  error: string | null;
  busy: boolean;
  onFullName: (value: string) => void;
  onPhone: (value: string) => void;
  onSource: (value: (typeof SOURCES)[number]) => void;
  onLocationId: (value: string) => void;
  onSubmit: () => void;
}) {
  return (
    <div className="rounded-card border border-line bg-paper p-3.5 space-y-3">
      <p className="text-[13px] font-medium">Quick capture</p>

      {/* Owner redesign (C2) — shared labelled controls. The capture
          card uses the primitives' own tints: a neutral entry field and
          the shared picker surface. No page-local surface override is
          added on top of them. */}
      <Field id="enquiry-capture-name-field" label="Name">
        {(field) => (
          <Input
            {...field}
            type="text"
            value={fullName}
            onChange={(e) => onFullName(e.target.value)}
            data-testid="enquiry-capture-name"
          />
        )}
      </Field>

      <Field id="enquiry-capture-phone-field" label="Phone (optional)">
        {(field) => (
          <Input
            {...field}
            type="tel"
            value={phone}
            onChange={(e) => onPhone(e.target.value)}
          />
        )}
      </Field>

      <Field id="enquiry-capture-source-field" label="Source">
        {(field) => (
          <Select
            {...field}
            value={source}
            onChange={(e) => onSource(e.target.value as (typeof SOURCES)[number])}
          >
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        )}
      </Field>

      {locations.length > 1 ? (
        <Field id="enquiry-capture-location-field" label="Site">
          {(field) => (
            <Select
              {...field}
              value={locationId}
              onChange={(e) => onLocationId(e.target.value)}
              data-testid="enquiry-capture-location"
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : null}

      <Button
        variant="primary"
        size="md"
        onClick={onSubmit}
        disabled={busy || !fullName.trim() || !locationId}
        className="w-full"
        data-testid="enquiry-capture-submit"
      >
        {busy ? "Saving…" : "Capture enquiry"}
      </Button>

      {error ? (
        <p role="alert" className="text-[12px] text-ink-2">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function EnquiryList({
  enquiries,
  detailHrefPrefix,
}: {
  enquiries: EnquiryRow[];
  detailHrefPrefix: string;
}) {
  return (
    <ul data-testid="enquiries-list">
      {enquiries.length === 0 ? (
        <li className="rounded-ctl border border-line bg-paper list-none">
          <EmptyState
            title="No enquiries yet"
            body="Capture a walk-in, phone call or online lead — name and source only at first contact."
          />
        </li>
      ) : (
        enquiries.map((e) => (
          <li key={e.id} className="border-b border-line last:border-0">
            <Link href={`${detailHrefPrefix}/${e.id}`} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium">{e.fullName}</p>
                <p className="mt-0.5 text-[12px] text-ink-3">
                  {e.source}
                  {e.phone ? ` · ${formatPhoneIN(e.phone)}` : ""}
                  {/* R04 — only management sees an unassigned row; the
                      label makes the review state explicit. */}
                  {e.locationId ? "" : " · Unassigned site"}
                </p>
              </div>
              <StatusBadge tone={ENQUIRY_STAGE_TONE[e.stage] ?? "neutral"}>
                {ENQUIRY_STAGE_LABELS[e.stage]}
              </StatusBadge>
            </Link>
          </li>
        ))
      )}
    </ul>
  );
}
