"use client";

import { useEffect, useRef, useState } from "react";
import { createEnquiryAction } from "@/lib/actions/enquiries";
import type { EnquiryRow } from "@/lib/services/enquiries";
import { OwnerCreateAction } from "@/components/owner-ui/owner-create-action";
import { Button } from "@/components/ui/Button";
import {
  EnquiryCaptureCard,
  type CaptureSource,
} from "@/components/enquiry-capture-card";
import { EnquiryList, type EnquiriesListVariant } from "@/components/enquiries-list";
import { ENQUIRY_STAGE_LABELS } from "@/lib/enquiry-stage-graph";
import type { OverdueFollowUp } from "@/lib/services/enquiries";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { formatDateIST } from "@/lib/time/tz";

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
export type EnquiriesBoardVariant = EnquiriesListVariant;
type EnquiryReturn = {token:string; namespace:string; search:string; stage:string};
let enquiryReturn: EnquiryReturn | null = null;

export function EnquiriesBoard({
  initialEnquiries,
  detailHrefPrefix = "/owner/enquiries",
  locations,
  canWrite,
  variant = "front-desk",
  overdueFollowUps = [],
  navigationNamespace,
}: {
  initialEnquiries: EnquiryRow[];
  detailHrefPrefix?: string;
  // R04 (2026-10-13 role-workflow audit) — capture requires a site;
  // the caller's allowed locations come from the server page.
  locations: Array<{ id: string; name: string }>;
  canWrite: boolean;
  variant?: EnquiriesBoardVariant;
  overdueFollowUps?: OverdueFollowUp[];
  navigationNamespace?: string;
}) {
  const [enquiries, setEnquiries] = useState(initialEnquiries);
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState("active");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState<CaptureSource>("walk-in");
  const [locationId, setLocationId] = useState(locations[0]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [captureOpen, setCaptureOpen] = useState(variant === "front-desk");
  // The EXPLICIT intents. Both counters start at 0, so nothing is
  // focused on arrival and reception's always-visible capture is never
  // focused at all: only a press by the owner moves the focus.
  const [openIntent, setOpenIntent] = useState(0);
  const [closeIntent, setCloseIntent] = useState(0);
  // The real name field of the capture card, and the area that holds
  // the owner's create action. Both are typed DOM references — no
  // timer, no history and no cache is involved.
  const nameFieldRef = useRef<HTMLInputElement>(null);
  const actionAreaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (variant !== "oversight" || !navigationNamespace || !enquiryReturn) return;
    if (window.history.state?.aquaEnquiryToken !== enquiryReturn.token || enquiryReturn.namespace !== navigationNamespace) return;
    setSearch(enquiryReturn.search);
    setStage(enquiryReturn.stage);
  }, [navigationNamespace,variant]);
  function remember(nextSearch:string,nextStage:string) {
    if (!navigationNamespace || variant !== "oversight") return;
    const token = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    enquiryReturn = {token,namespace:navigationNamespace,search:nextSearch,stage:nextStage};
    window.history.replaceState({...window.history.state,aquaEnquiryToken:token},"");
  }
  const term = search.trim().toLocaleLowerCase();
  const visibleEnquiries = variant === "oversight" ? enquiries.filter((enquiry) => {
    const matchesStage = stage === "all" || (stage === "active" ? enquiry.stage !== "converted" && enquiry.stage !== "lost" : enquiry.stage === stage);
    return matchesStage && (!term || `${enquiry.fullName} ${enquiry.phone ?? ""}`.toLocaleLowerCase().includes(term));
  }) : enquiries;
  const filters = variant === "oversight" ? <div className="flex flex-wrap items-end gap-2">
    <label className="min-w-0 flex-1 text-[13px] text-ink-2">Search enquiries<input value={search} onChange={event => { setSearch(event.target.value); remember(event.target.value,stage); }} type="search" className="mt-1 block min-h-11 w-full rounded-ctl border border-line bg-paper px-3 text-ink" /></label>
    <label className="text-[13px] text-ink-2">Stage<select value={stage} onChange={event => { setStage(event.target.value); remember(search,event.target.value); }} className="mt-1 block min-h-11 rounded-ctl border border-line bg-paper px-3 text-ink"><option value="active">Active</option><option value="all">All history</option>{Object.entries(ENQUIRY_STAGE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
  </div> : null;
  const list = visibleEnquiries.length === 0 && (term || stage !== "all") && enquiries.length > 0
    ? <p className="text-[13px] text-ink-2">No enquiries match these filters.</p>
    : <EnquiryList enquiries={visibleEnquiries} detailHrefPrefix={detailHrefPrefix} variant={variant} />;
  const visibleOverdue = overdueFollowUps.filter((followUp) => visibleEnquiries.some((enquiry) => enquiry.id === followUp.enquiryId));
  const dueList = variant === "oversight" && visibleOverdue.length > 0 ? <section className="rounded-card border border-line bg-paper p-4">
    <h2 className="font-display text-[16px] font-semibold">Overdue follow-ups</h2>
    <ul className="divide-y divide-line">{visibleOverdue.map((followUp) => <li key={followUp.id} className="py-2">
      <Link href={`${detailHrefPrefix}/${followUp.enquiryId}`} aria-label={`Follow up ${followUp.enquiryName}`} className="inline-flex min-h-11 flex-col justify-center text-[13px] text-ink">
        <span>{followUp.enquiryName} · due {formatDateIST(followUp.dueAt)}</span>
        {followUp.note ? <span className="text-ink-2">{followUp.note}</span> : null}
      </Link>
    </li>)}</ul>
  </section> : null;

  // Opening the capture on the owner's page: the card opens BELOW the
  // list, so on a long list it opens off-screen. The owner's own press
  // is the intent — the field is focused and brought into the viewport
  // so the capture is where the owner can see it.
  //
  // The scroll uses the BROWSER'S OWN default: asking for
  // `behavior: "smooth"` forces an animated scroll on every reader,
  // including the ones who asked the platform for reduced motion
  // (docs/design-system/motion.md — "Never force smooth scrolling").
  // The default scroll honours that preference without a special case.
  useEffect(() => {
    if (openIntent === 0) return;
    const field = nameFieldRef.current;
    if (!field) return;
    field.focus();
    field.scrollIntoView({ block: "center" });
  }, [openIntent]);

  // Closing the capture returns the focus to the SAME create action
  // that opened it, so the owner never loses their place. The shared
  // action does not forward a ref, so the element is found inside this
  // board's own area by the shared marker it renders.
  useEffect(() => {
    if (closeIntent === 0) return;
    const action = actionAreaRef.current?.querySelector<HTMLButtonElement>(
      "[data-owner-create-action]",
    );
    action?.focus();
  }, [closeIntent]);

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
        {filters}
        {dueList}
        {list}
      </div>
    );
  }

  const capture = (
    <EnquiryCaptureCard
      fullName={fullName}
      phone={phone}
      source={source}
      locationId={locationId}
      locations={locations}
      error={error}
      busy={busy}
      nameFieldRef={nameFieldRef}
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
      <div className="space-y-4" ref={actionAreaRef}>
        {filters}
        {dueList}
        {list}
        {/* The ONE create action for enquiries: the shared floating
            action on a phone and the labelled action on a desktop — the
            SAME control the other owner pages use, not a second shape
            and not an ordinary boxed button. It OPENS the capture panel
            and never submits it. While its own panel is open the action
            is hidden, so the owner never has two ways in and the
            floating action never covers the form; the close control
            lives with the panel it closes. */}
        {captureOpen ? (
          <div id="enquiry-capture" className="mt-3">
            <div className="flex justify-end">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setCaptureOpen(false);
                  setCloseIntent((n) => n + 1);
                }}
                aria-expanded={true}
                aria-controls="enquiry-capture"
              >
                Close enquiry capture
              </Button>
            </div>
            {capture}
          </div>
        ) : (
          <OwnerCreateAction
            kind="button"
            onClick={() => {
              setCaptureOpen(true);
              setOpenIntent((n) => n + 1);
            }}
            label="Add enquiry"
            testId="enquiries-create-action"
          />
        )}
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
