"use client";

import { useEffect, useRef, useState } from "react";
import { createEnquiryAction, listEnquiriesAction } from "@/lib/actions/enquiries";
import type { EnquiryRow } from "@/lib/services/enquiries";
import { OwnerCreateAction } from "@/components/owner-ui/owner-create-action";
import { OwnerControlSheet } from "@/components/owner-ui/owner-control-sheet";
import { Dialog } from "@/components/ui/Dialog";
import { Button, buttonClasses } from "@/components/ui/Button";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import {
  EnquiryCaptureCard,
  type CaptureSource,
} from "@/components/enquiry-capture-card";
import { EnquiryList, type EnquiriesListVariant } from "@/components/enquiries-list";
import { ENQUIRY_STAGE_LABELS } from "@/lib/enquiry-stage-graph";
import type { OverdueFollowUp } from "@/lib/services/enquiries";
import { EnquiriesOverduePreview } from "@/components/enquiries-overdue-preview";
import { isOptionalContactPhoneValid } from "@/lib/contact-phone";

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
type DeskMode = "capture" | "find";
type EnquiryReturn = { token: string; namespace: string; search: string; stage: string; mode: DeskMode };
let enquiryReturn: EnquiryReturn | null = null;

export function EnquiriesBoard({
  initialEnquiries,
  detailHrefPrefix = "/owner/enquiries",
  locations,
  canWrite,
  openCapture = false,
  compactFilters = false,
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
  openCapture?: boolean;
  compactFilters?: boolean;
  variant?: EnquiriesBoardVariant;
  overdueFollowUps?: OverdueFollowUp[];
  navigationNamespace?: string;
}) {
  const [enquiries, setEnquiries] = useState(initialEnquiries);
  const [search, setSearch] = useState("");
  const [stage, setStage] = useState(variant === "oversight" ? "active" : "all");
  const [deskMode, setDeskMode] = useState<DeskMode>(canWrite && locations.length ? "capture" : "find");
  const [saved, setSaved] = useState<EnquiryRow | null>(null);
  const [checking, setChecking] = useState(false);
  const submitting = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState<CaptureSource>("walk-in");
  const [locationId, setLocationId] = useState(locations.length === 1 ? locations[0].id : "");
  const [error, setError] = useState<string | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const captureRequested = openCapture && canWrite && locations.length > 0;
  const [captureOpen, setCaptureOpen] = useState(variant === "front-desk" || captureRequested);
  // The EXPLICIT intents. Both counters start at 0, so nothing is
  // focused on arrival and reception's always-visible capture is never
  // focused at all: only a press by the owner moves the focus.
  const [openIntent, setOpenIntent] = useState(captureRequested && variant === "oversight" ? 1 : 0);
  const [closeIntent, setCloseIntent] = useState(0);
  // The real name field of the capture card, and the area that holds
  // the owner's create action. Both are typed DOM references — no
  // timer, no history and no cache is involved.
  const nameFieldRef = useRef<HTMLInputElement>(null);
  const phoneFieldRef = useRef<HTMLInputElement>(null);
  const actionAreaRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (phoneError) phoneFieldRef.current?.focus();
  }, [phoneError]);
  useEffect(() => {
    if (!navigationNamespace || !enquiryReturn) return;
    if (window.history.state?.aquaEnquiryToken !== enquiryReturn.token || enquiryReturn.namespace !== navigationNamespace) return;
    setSearch(enquiryReturn.search);
    setStage(enquiryReturn.stage);
    setDeskMode(enquiryReturn.mode);
  }, [navigationNamespace,variant]);
  function remember(nextSearch: string, nextStage: string, mode = deskMode) {
    if (!navigationNamespace) return;
    const token = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    enquiryReturn = {token,namespace:navigationNamespace,search:nextSearch,stage:nextStage,mode};
    window.history.replaceState({...window.history.state,aquaEnquiryToken:token},"");
  }
  const term = search.trim().toLocaleLowerCase();
  const digits = term.replace(/[^0-9]/g, "");
  const overdueIds = new Set(overdueFollowUps.map((entry) => entry.enquiryId));
  const showFilters = variant === "oversight" || deskMode === "find";
  const visibleEnquiries = showFilters ? enquiries.filter((enquiry) => {
    const matchesStage = stage === "all"
      || (stage === "active" && enquiry.stage !== "converted" && enquiry.stage !== "lost")
      || (stage === "follow-ups" && overdueIds.has(enquiry.id))
      || enquiry.stage === stage;
    return matchesStage && (
      !term || enquiry.fullName.toLocaleLowerCase().includes(term)
      || (digits.length > 0 && /^[+\d\s()-]+$/.test(term) && enquiry.phone?.replace(/[^0-9]/g, "").includes(digits))
    );
  }) : enquiries;
  const stageName = stage === "active" ? "Active enquiries" : stage === "all" ? "All stages" : stage === "follow-ups" ? "Needs follow-up" : ENQUIRY_STAGE_LABELS[stage as keyof typeof ENQUIRY_STAGE_LABELS];
  const stageControl = (
    <label className="min-w-0 text-[13px] text-ink-2">
      Stage
      <select id="enquiry-stage-filter" value={stage} onChange={(event) => { setStage(event.target.value); remember(search, event.target.value); }} className="mt-1 block min-h-11 w-full rounded-ctl border border-line bg-paper px-3 text-[16px] text-ink">
        <option value="active">Active</option>
        <option value="all">All history</option>
        {variant === "oversight" ? <option value="follow-ups">Needs follow-up</option> : null}
        {Object.entries(ENQUIRY_STAGE_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
    </label>
  );
  const filters = showFilters ? (
    <div className="grid grid-cols-1 items-end gap-2 min-[375px]:grid-cols-[minmax(0,1fr)_150px]">
      <label className="min-w-0 text-[13px] text-ink-2">
        Search enquiries
        <input ref={searchRef} value={search} onChange={(event) => { setSearch(event.target.value); remember(event.target.value, stage); }} type="search" className="mt-1 block min-h-11 w-full rounded-ctl border border-line bg-paper px-3 text-[16px] text-ink" />
      </label>
      {compactFilters ? <OwnerControlSheet label="Enquiry stage" value={stageName} immediate>{stageControl}</OwnerControlSheet> : stageControl}
      <p className="text-[13px] text-ink-2 min-[375px]:col-span-2" aria-live="polite">{visibleEnquiries.length} of {enquiries.length} enquiries shown</p>
    </div>
  ) : null;
  const list = visibleEnquiries.length === 0 && (term || stage !== "all") && enquiries.length > 0
    ? <div>
        <p className="text-[13px] text-ink-2">No enquiries match these filters.</p>
        <Button variant="ghost" size="sm" onClick={() => { setSearch(""); setStage("all"); remember("", "all"); }}>Show all enquiries</Button>
      </div>
    : <EnquiryList enquiries={visibleEnquiries} detailHrefPrefix={detailHrefPrefix} variant={variant} />;
  const visibleIds = new Set(visibleEnquiries.map((enquiry) => enquiry.id));
  const visibleOverdue = overdueFollowUps.filter((followUp) => visibleIds.has(followUp.enquiryId));
  const oversightLists = <div className={`grid items-start gap-4 ${visibleOverdue.length > 0 ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]" : ""}`}>
    {visibleOverdue.length > 0 ? <EnquiriesOverduePreview followUps={visibleOverdue} detailHrefPrefix={detailHrefPrefix}
      onShowQueue={stage === "follow-ups" ? undefined : () => { setStage("follow-ups"); remember(search, "follow-ups"); }} /> : null}
    <div className="min-w-0 space-y-3"><div className="owner-work-panel">{filters}</div>{list}</div>
  </div>;

  // Focus the opened capture so the form is ready for the next keystroke.
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
    field.scrollIntoView?.({ block: "center" });
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
    if (submitting.current || !fullName.trim() || !locationId) return;
    setSaved(null);
    setError(null);
    if (!isOptionalContactPhoneValid(phone)) {
      setPhoneError("Enter a valid phone number.");
      return;
    }
    setPhoneError(null);
    submitting.current = true;
    setBusy(true);
    try {
      const enquiry = await createEnquiryAction({
        fullName: fullName.trim(),
        phone: phone.trim() || undefined,
        source,
        locationId,
      });
      setEnquiries((rows) => [enquiry, ...rows.filter((row) => row.id !== enquiry.id)]);
      setSaved(enquiry);
      setFullName("");
      setPhone("");
    } catch {
      // R07 — a refused capture shows an inline error; the typed
      // details stay in the controlled fields.
      setError("Could not confirm the save. Check saved enquiries before trying again.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  async function checkSavedEnquiries() {
    if (checking) return;
    setChecking(true);
    try {
      const rows = await listEnquiriesAction({});
      setEnquiries(rows);
      if (variant === "front-desk") setDeskMode("find");
      else setCaptureOpen(false);
      setSearch(fullName.trim());
      setStage("all");
      remember(fullName.trim(), "all", "find");
    } catch {
      setError("Could not check saved enquiries. Your draft is still here. Try the check again when connected.");
    } finally {
      setChecking(false);
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
        {variant === "oversight" ? oversightLists : <>{filters}{list}</>}
      </div>
    );
  }

  const capture = (
    <div className="space-y-3">
    <EnquiryCaptureCard
      fullName={fullName}
      phone={phone}
      source={source}
      locationId={locationId}
      locations={locations}
      error={error}
      phoneError={phoneError}
      busy={busy}
      nameFieldRef={nameFieldRef}
      phoneFieldRef={phoneFieldRef}
      onFullName={setFullName}
      onPhone={(value) => { setPhone(value); setPhoneError(null); }}
      onSource={setSource}
      onLocationId={setLocationId}
      onSubmit={() => void submit()}
    />
    {error ? <Button size="sm" disabled={checking} onClick={() => void checkSavedEnquiries()}>{checking ? "Checking saved enquiries…" : "Check saved enquiries"}</Button> : null}
    {saved ? (
      <div className="space-y-1 rounded-ctl border border-line bg-good-soft p-3">
        <p role="status" className="text-sm text-ink">Enquiry saved for {saved.fullName}.</p>
        <Link href={`${detailHrefPrefix}/${saved.id}`} className={buttonClasses({ size: "sm" })}>Open saved enquiry</Link>
      </div>
    ) : null}
    </div>
  );

  if (variant === "oversight" && compactFilters) {
    return (
      <div className="space-y-4" ref={actionAreaRef}>
        <OwnerCreateAction kind="button" label="Add enquiry" testId="enquiries-create-action"
          onClick={() => { setCaptureOpen(true); setOpenIntent(intent => intent + 1); }} />
        {oversightLists}
        <Dialog open={captureOpen} onOpenChange={setCaptureOpen} title="Add enquiry">
          {captureOpen ? capture : null}
        </Dialog>
      </div>
    );
  }

  if (variant === "oversight") {
    // Owner oversight leads; the routine capture stays secondary.
    return (
      <div className="space-y-4" ref={actionAreaRef}>
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
        {oversightLists}
      </div>
    );
  }

  function changeMode(mode: DeskMode) {
    setDeskMode(mode);
    remember(search, stage, mode);
    if (mode === "capture") setOpenIntent((intent) => intent + 1);
    else requestAnimationFrame(() => searchRef.current?.focus());
  }

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Enquiry tasks" className="flex flex-wrap gap-2">
        <Button size="sm" data-testid="enquiry-mode-capture" aria-pressed={deskMode === "capture"}
          variant={deskMode === "capture" ? "primary" : "secondary"} disabled={busy || checking}
          onClick={() => changeMode("capture")}>Capture enquiry</Button>
        <Button size="sm" disabled={busy || checking} aria-pressed={deskMode === "find"} variant={deskMode === "find" ? "primary" : "secondary"}
          onClick={() => changeMode("find")}>Find enquiry</Button>
      </div>
      {deskMode === "capture" ? capture : filters}
      {list}
    </div>
  );
}
