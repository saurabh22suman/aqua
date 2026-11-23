"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { OwnerBriefDate } from "@/components/owner-home/owner-brief/owner-brief-date";
import { getScheduleGridAction } from "@/lib/actions/schedule-grid";
import { addDays, formatWallTime24hIST } from "@/lib/time/tz";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { getOwnerHomeBriefAction } from "@/lib/actions/owner-home-brief";
import { titleCase } from "@/lib/terminology/keys";
import { FACILITY_COOKIE } from "@/lib/facility";
import type { OwnerBriefSession, OwnerBriefView } from "@/lib/services/owner-home-brief";
import { OwnerCollectionsMoney } from "@/components/owner-home/owner-brief/owner-collections-money";
import { OwnerBriefFacilities } from "@/components/owner-home/owner-brief/owner-brief-facilities";
import { OwnerCollectionsAgenda } from "@/components/owner-home/owner-brief/owner-collections-agenda";

// The facility switch commits only when the complete authorized view arrives.
type DatedAgenda = { key: string; sessions: OwnerBriefSession[] | null };

type Failure = { facilityId: string | null; label: string };

function writeFacilityCookie(value: string | null): void {
  const base = `${FACILITY_COOKIE}=`;
  document.cookie =
    value === null
      ? `${base}; path=/; max-age=0; samesite=lax`
      : `${base}${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
}

export function OwnerBriefHome({
  initialView,
  sport,
  facilityNoun = "facility",
}: {
  initialView: OwnerBriefView;
  sport: "pool" | "court";
  facilityNoun?: string;
}) {
  const [view, setView] = useState(initialView);
  const [pending, setPending] = useState<string | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [status, setStatus] = useState("");
  const sheet = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [scopeSlot, setScopeSlot] = useState<HTMLElement | null>(null);
  const touchStart = useRef<number | null>(null);
  const router = useRouter();

  useEffect(() => {
    setScopeSlot(document.querySelector<HTMLElement>("[data-owner-brief-scope-slot]"));
  }, []);

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  const [pickedDate, setPickedDate] = useState(initialView.todayIso);
  const selectedDate = pickedDate < addDays(view.todayIso, -6) || pickedDate > view.todayIso
    ? view.todayIso : pickedDate;
  const historical = selectedDate !== view.todayIso;
  const scheduleHref = historical ? `/owner/schedule?${new URLSearchParams({
    date: selectedDate, facility: view.facilityId ?? "all",
  })}` : view.scheduleHref;
  const agendaKey = `${view.facilityId ?? "all"}:${selectedDate}`;
  const [agenda, setAgenda] = useState<DatedAgenda | null>(null);
  const [agendaRetry, setAgendaRetry] = useState(0);

  useEffect(() => {
    if (!historical || !view.can.schedule) return;
    let active = true;
    void getScheduleGridAction({
      fromDate: selectedDate,
      toDate: selectedDate,
      ...(view.facilityId ? { locationId: view.facilityId } : {}),
    }).then(rows => {
      if (active) setAgenda({ key: agendaKey, sessions: rows.slice(0, 2).map(row => ({
        id: row.id,
        timeLabel: formatWallTime24hIST(new Date(row.startsAt)),
        title: row.batchName,
        detail: [row.locationName, row.coachName].filter(Boolean).join(" · ") || null,
        href: scheduleHref,
        isNextDay: false,
        statusLabel: row.status === "cancelled" ? "Cancelled" : undefined,
      })) });
    }).catch(() => {
      if (active) setAgenda({ key: agendaKey, sessions: null });
    });
    return () => { active = false; };
  }, [agendaKey, agendaRetry, historical, scheduleHref, selectedDate, view.can.schedule, view.facilityId]);

  const currentAgenda = agenda?.key === agendaKey ? agenda : null;
  const upcoming = view.upcomingSessions?.length
    ? view.upcomingSessions : view.session ? [view.session] : [];
  const sessions = historical ? currentAgenda?.sessions ?? [] : upcoming;
  const agendaState = historical && !currentAgenda ? "loading" : historical && !currentAgenda?.sessions ? "failed" : "ready";

  function closeScope() {
    sheet.current?.close();
  }

  async function switchFacility(facilityId: string | null) {
    if (pending) return;
    closeScope();
    if (facilityId === view.facilityId) {
      trigger.current?.focus({ preventScroll: true });
      return;
    }
    const label =
      (facilityId
        ? view.facilities.find((facility) => facility.id === facilityId)?.name
        : "All facilities") ?? "Selected facility";
    setPending(label);
    setFailure(null);
    setStatus(`Loading ${label}… Still showing ${view.scopeLabel}.`);
    try {
      const next = await getOwnerHomeBriefAction(
        facilityId ? { facility: facilityId } : {},
      );
      setView(next);
      setStatus(`Showing ${next.scopeLabel}.`);
      writeFacilityCookie(facilityId);
      const params = new URLSearchParams(window.location.search);
      params.set("facility", facilityId ?? "all");
      router.replace(`${window.location.pathname}?${params.toString()}`, {
        scroll: false,
      });
      trigger.current?.focus({ preventScroll: true });
    } catch {
      setFailure({ facilityId, label });
      setStatus(`Couldn’t load ${label}. Still showing ${view.scopeLabel}.`);
    } finally {
      setPending(null);
    }
  }

  useEffect(() => {
    if (!status || pending) return;
    if (failure) {
      document.querySelector<HTMLButtonElement>("[data-brief-retry]")?.focus({ preventScroll: true });
    } else {
      trigger.current?.focus({ preventScroll: true });
    }
  }, [failure, pending, status]);

  const canOpenScope = view.multiFacility;
  const scopeControl = (
      <div className="brief-scope-bar">
        {canOpenScope ? (
          <button
            ref={trigger}
            type="button"
            className="brief-scope"
            aria-haspopup="dialog"
            aria-label={`Facility scope, ${view.scopeLabel}`}
            disabled={pending !== null}
            onClick={() => sheet.current?.showModal()}
          >
            <OwnerIcon name="pin" size={14} className="brief-scope-pin" />
            <span>{view.scopeLabel}</span>
            <OwnerIcon name="down" size={13} />
          </button>
        ) : (
          <span className="brief-scope" title={view.scopeLabel}>
            <OwnerIcon name="pin" size={14} className="brief-scope-pin" />
            <span>{view.scopeLabel}</span>
          </span>
        )}
      </div>
  );
  return (
    <div className="brief-home" data-collections-home data-brief-sport={sport}>
      {scopeSlot ? createPortal(scopeControl, scopeSlot) : scopeControl}
      <OwnerBriefDate today={view.todayIso} selected={selectedDate} onSelect={setPickedDate} />

      <div key={view.facilityId ?? "all"} className={status.startsWith("Showing ") ? "brief-body brief-updated" : "brief-body"}>
        <div className="brief-money-column">
          <OwnerCollectionsMoney
            money={view.money}
            cashReview={view.cashReview}
            cashHref={view.cashHref}
            overdueHref={view.overdueHref}
            feesHref={view.feesHref}
            scopeLabel={view.scopeLabel}
            todayIso={view.todayIso}
            selectedDate={selectedDate}
            facilityId={view.facilityId}
            canReadFees={view.can.fees}
          />
        </div>
        <div className="brief-today-column">
          <OwnerCollectionsAgenda
            sessions={sessions}
            historical={historical}
            agendaState={agendaState}
            onRetry={() => { setAgenda(null); setAgendaRetry(retry => retry + 1); }}
            followUps={view.followUps}
            scheduleHref={scheduleHref}
            canSchedule={view.can.schedule}
            canEnquiries={view.can.enquiries}
          />
        </div>
        {view.can.fees && view.multiFacility && view.facilityId === null ? (
          <OwnerBriefFacilities
            onSelect={(facilityId) => void switchFacility(facilityId)}
            disabled={pending !== null}
            facilityCount={view.facilities.length}
            facilityNoun={facilityNoun}
          />
        ) : null}
      </div>

      {status || failure ? (
        <p
          className={pending || failure ? `brief-net${failure ? " is-error" : " is-pending"}` : "sr-only"}
          role="status"
          aria-atomic="true"
        >
          {status}
          {failure ? (
            <button
              type="button"
              data-brief-retry=""
              className="brief-quiet"
              onClick={() => void switchFacility(failure.facilityId)}
            >
              Retry
            </button>
          ) : null}
        </p>
      ) : null}

      {canOpenScope ? (
        <dialog
          ref={sheet}
          className="brief-sheet"
          aria-labelledby="brief-scope-title"
          onClose={() => trigger.current?.focus({ preventScroll: true })}
        >
          <header
            className="brief-sheet-head"
            onTouchStart={(event) => {
              if ((event.target as HTMLElement).closest("button")) return;
              touchStart.current = event.touches[0]?.clientY ?? null;
            }}
            onTouchEnd={(event) => {
              const delta =
                (event.changedTouches[0]?.clientY ?? 0) - (touchStart.current ?? 0);
              if (
                touchStart.current !== null &&
                delta > 62 &&
                (sheet.current?.scrollTop ?? 0) <= 0
              ) {
                closeScope();
              }
              touchStart.current = null;
            }}
            onTouchCancel={() => {
              touchStart.current = null;
            }}
          >
            <div>
              <span className="brief-grip" aria-hidden="true" />
              <h2 id="brief-scope-title">{titleCase(facilityNoun)} scope</h2>
            </div>
            <button
              type="button"
              className="brief-icon-button"
              aria-label="Close facility scope"
              onClick={closeScope}
            >
              <span aria-hidden="true">×</span>
            </button>
          </header>
          <div className="brief-sheet-body">
            <p className="brief-sheet-copy">
              Figures stay on the current scope until the new one loads.
            </p>
            <button
              type="button"
              className="brief-picker-option"
              aria-current={view.facilityId === null ? "true" : undefined}
              onClick={() => void switchFacility(null)}
            >
              All facilities
              {view.facilityId === null ? (
                <OwnerIcon name="check" size={16} />
              ) : (
                <OwnerIcon name="chevron" size={15} />
              )}
            </button>
            {view.facilities.map((facility) => (
              <button
                key={facility.id}
                type="button"
                className="brief-picker-option"
                aria-current={view.facilityId === facility.id ? "true" : undefined}
                onClick={() => void switchFacility(facility.id)}
              >
                {facility.name}
                {view.facilityId === facility.id ? (
                  <OwnerIcon name="check" size={16} />
                ) : (
                  <OwnerIcon name="chevron" size={15} />
                )}
              </button>
            ))}
          </div>
        </dialog>
      ) : null}
    </div>
  );
}
