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
import { formatPhoneIN } from "@/lib/phone";

const SOURCES = ["walk-in", "phone", "referral", "online", "other"] as const;

export function EnquiriesBoard({
  initialEnquiries,
  detailHrefPrefix = "/owner/enquiries",
  locations,
  canWrite,
}: {
  initialEnquiries: EnquiryRow[];
  detailHrefPrefix?: string;
  // R04 (2026-10-13 role-workflow audit) — capture requires a site;
  // the caller's allowed locations come from the server page.
  locations: Array<{ id: string; name: string }>;
  canWrite: boolean;
}) {
  const [enquiries, setEnquiries] = useState(initialEnquiries);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState<(typeof SOURCES)[number]>("walk-in");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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

  return (
    <div className="space-y-4">
      <div className="rounded-card border border-line bg-paper p-3.5 space-y-2">
        <p className="text-[13px] font-medium">Quick capture</p>
        <label className="block">
          <span className="block text-[12px] text-ink-3 mb-1">Name</span>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Name"
            className="w-full min-h-11 rounded-ctl border border-line bg-deck px-3 py-2 text-[16px]"
            data-testid="enquiry-capture-name"
          />
        </label>
        <label className="block">
          <span className="block text-[12px] text-ink-3 mb-1">Phone (optional)</span>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Phone (optional)"
            className="w-full min-h-11 rounded-ctl border border-line bg-deck px-3 py-2 text-[16px]"
          />
        </label>
        <label className="block">
          <span className="block text-[12px] text-ink-3 mb-1">Source</span>
          <select
            value={source}
            onChange={(e) => setSource(e.target.value as (typeof SOURCES)[number])}
            aria-label="Source"
            className="w-full min-h-11 rounded-ctl border border-line bg-deck px-3 py-2 text-[16px]"
          >
            {SOURCES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        {locations.length > 1 ? (
          <label className="block">
            <span className="block text-[12px] text-ink-3 mb-1">Site</span>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              aria-label="Site"
              className="w-full min-h-11 rounded-ctl border border-line bg-deck px-3 py-2 text-[16px]"
              data-testid="enquiry-capture-location"
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button
          type="button"
          onClick={submit}
          disabled={busy || !fullName.trim() || !locationId}
          className="min-h-11 w-full rounded-ctl bg-[var(--accent-strong)] py-2.5 text-[14px] font-medium text-white disabled:opacity-50"
          data-testid="enquiry-capture-submit"
        >
          {busy ? "Saving…" : "Capture enquiry"}
        </button>
        {error ? (
          <p role="alert" className="text-[12px] text-ink-2">
            {error}
          </p>
        ) : null}
      </div>

      <EnquiryList enquiries={enquiries} detailHrefPrefix={detailHrefPrefix} />
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
        <li className="rounded-ctl border border-line bg-paper px-4 py-8 text-center">
          <p className="text-[14px] font-medium">No enquiries yet</p>
          <p className="mt-1 text-[12.5px] text-ink-3">
            Capture a walk-in, phone call, or online lead above — name and source only at first contact.
          </p>
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
