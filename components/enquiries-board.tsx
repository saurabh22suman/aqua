"use client";

import { useState } from "react";
import Link from "next/link";
import { createEnquiryAction } from "@/lib/actions/enquiries";
import type { EnquiryRow } from "@/lib/services/enquiries";
import { ENQUIRY_STAGE_LABELS } from "@/lib/enquiry-stage-graph";

const SOURCES = ["walk-in", "phone", "referral", "online", "other"] as const;

export function EnquiriesBoard({ initialEnquiries }: { initialEnquiries: EnquiryRow[] }) {
  const [enquiries, setEnquiries] = useState(initialEnquiries);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState<(typeof SOURCES)[number]>("walk-in");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!fullName.trim()) return;
    setBusy(true);
    try {
      const enquiry = await createEnquiryAction({
        fullName: fullName.trim(),
        phone: phone.trim() || undefined,
        source,
      });
      setEnquiries((e) => [enquiry, ...e]);
      setFullName("");
      setPhone("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-card border border-line bg-paper p-3.5 space-y-2">
        <p className="text-[13px] font-medium">Quick capture</p>
        <input
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          placeholder="Name"
          className="w-full rounded-ctl border border-line bg-deck px-3 py-2 text-[14px]"
          data-testid="enquiry-capture-name"
        />
        <input
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="Phone (optional)"
          className="w-full rounded-ctl border border-line bg-deck px-3 py-2 text-[14px]"
        />
        <select
          value={source}
          onChange={(e) => setSource(e.target.value as (typeof SOURCES)[number])}
          className="w-full rounded-ctl border border-line bg-deck px-3 py-2 text-[14px]"
        >
          {SOURCES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={submit}
          disabled={busy || !fullName.trim()}
          className="w-full rounded-ctl bg-mango py-2.5 text-[14px] font-medium text-white disabled:opacity-50"
          data-testid="enquiry-capture-submit"
        >
          {busy ? "Saving…" : "Capture enquiry"}
        </button>
      </div>

      <ul data-testid="enquiries-list">
        {enquiries.length === 0 ? (
          <li className="rounded-ctl border border-line bg-paper px-4 py-8 text-center">
            <p className="text-[13px] text-ink-3">No enquiries yet.</p>
          </li>
        ) : (
          enquiries.map((e) => (
            <li key={e.id} className="border-b border-line last:border-0">
              <Link href={`/owner/enquiries/${e.id}`} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium">{e.fullName}</p>
                  <p className="mt-0.5 text-[12px] text-ink-3">
                    {e.source}
                    {e.phone ? ` · ${e.phone}` : ""}
                  </p>
                </div>
                <span className="flex-none rounded-pill bg-deck px-2.5 py-1 text-[11px] font-medium text-ink-2">
                  {ENQUIRY_STAGE_LABELS[e.stage]}
                </span>
              </Link>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
