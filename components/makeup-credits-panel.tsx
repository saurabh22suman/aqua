"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import {
  grantMakeupCreditAction,
  listMakeupCreditsAction,
  listMakeupSourcesAction,
  listMakeupTargetsAction,
  redeemMakeupCreditAction,
} from "@/lib/actions/makeup";
import type {
  MakeupCreditRow,
  MakeupSessionOption,
} from "@/lib/services/makeup";
import { formatDateIST } from "@/lib/time/tz";
import { Select } from "@/components/ui/Select";
import {
  isFailedSeed,
  seedForMember,
  type MemberMakeupSeed,
} from "@/components/member-detail/member-panel-initial-data";

// R.7 (docs/five-day-work-guide.md) — makeup credits on the member
// detail page. Grant from an excused absence; redeem against another
// session in the member's batches. One free session per absence — no
// fee credit, no subscription adjustment (the service enforces the
// same rule).
//
// A02 (2026-10-09 role/content/permission audit §8) — granting is a
// management decision (programs.write), so the Grant affordance only
// renders for a caller the page has resolved as holding it; everyone
// else gets the ask-the-owner note instead of a button the action
// would refuse.
const STATUS_LABEL: Record<string, string> = {
  granted: "Available",
  redeemed: "Redeemed",
  expired: "Expired",
};

export function MakeupCreditsPanel({
  memberId,
  canGrant,
  canRedeem,
  initialData,
}: {
  memberId: string;
  // Owner overview only: the already-authorized server read. Absent for every
  // other consumer, which keeps its own mount read.
  initialData?: MemberMakeupSeed;
  canGrant: boolean;
  // R10 (2026-10-13 role-workflow audit) — redemption rides
  // attendance.mark (coach/front desk); the owner grants the credit
  // but does not redeem it. Readers keep the credit list.
  canRedeem: boolean;
}) {
  const router = useRouter();
  const seed = seedForMember(initialData, memberId);
  const seeded = seed && !isFailedSeed(seed) ? seed : null;
  const [credits, setCredits] = useState<MakeupCreditRow[] | null>(
    seeded ? seeded.credits : null,
  );
  const [sources, setSources] = useState<MakeupSessionOption[]>(
    seeded ? seeded.sources : [],
  );
  const [targets, setTargets] = useState<MakeupSessionOption[]>(
    seeded ? seeded.targets : [],
  );
  const [sourcePick, setSourcePick] = useState(
    seeded ? (seeded.sources[0]?.sessionId ?? "") : "",
  );
  const [targetPick, setTargetPick] = useState(
    seeded ? (seeded.targets[0]?.sessionId ?? "") : "",
  );
  const [error, setError] = useState<string | null>(
    seed && isFailedSeed(seed) ? "Could not load makeup credits." : null,
  );
  // Stale-response guard: a late read for another member is ignored.
  const currentMember = useRef(memberId);
  currentMember.current = memberId;
  const loadEpoch = useRef(0);
  const appliedSeed = useRef<typeof seed>(seed);
  const [busy, setBusy] = useState(false);

  async function load() {
    const at = memberId;
    const run = ++loadEpoch.current;
    setError(null);
    try {
      const [c, s, t] = await Promise.all([
        listMakeupCreditsAction(at),
        listMakeupSourcesAction(at),
        listMakeupTargetsAction(at),
      ]);
      if (at !== currentMember.current || run !== loadEpoch.current) return;
      setCredits(c);
      setSources(s);
      setTargets(t);
      setSourcePick(s[0]?.sessionId ?? "");
      setTargetPick(t[0]?.sessionId ?? "");
    } catch (err) {
      if (at !== currentMember.current || run !== loadEpoch.current) return;
      setError(err instanceof Error ? err.message : "Could not load makeup credits.");
      setCredits([]);
    }
  }

  useEffect(() => {
    // A usable seed for THIS member is already the authoritative read.
    if (seedForMember(initialData, memberId)) return;
    // A member change must never show the previous member's credits.
    setCredits(null);
    setError(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId, initialData]);

  // A fresh server seed for the same member still applies.
  useEffect(() => {
    const current = seedForMember(initialData, memberId);
    if (!current || appliedSeed.current === current) return;
    appliedSeed.current = current;
    // A newer authoritative read: an older pending one must not win.
    loadEpoch.current += 1;
    if (isFailedSeed(current)) {
      setError("Could not load makeup credits.");
      setCredits(null);
      return;
    }
    setError(null);
    setCredits(current.credits);
    setSources(current.sources);
    setTargets(current.targets);
    setSourcePick(current.sources[0]?.sessionId ?? "");
    setTargetPick(current.targets[0]?.sessionId ?? "");
  }, [initialData, memberId]);

  async function run(fn: () => Promise<{ kind: "ok" } | { kind: "error"; message: string }>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fn();
      if (res.kind === "error") {
        setError(res.message);
        return;
      }
      await load();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const available = (credits ?? []).filter((c) => c.status === "granted");

  return (
    <section className="mt-4 rounded-card border border-line bg-paper p-3.5">
      <h2 className="flex items-center gap-1.5 text-[13px] font-semibold uppercase tracking-[0.08em] text-ink-3">
        <Sparkles size={14} className="text-ink-3" />
        Makeup credits
      </h2>

      {error && credits === null ? (
        // A failed or refused read is stated, never left looking like a load
        // that never finished or an empty list.
        <div className="mt-2.5">
          <p className="text-[12px] text-ink-2">{error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-2 inline-flex min-h-11 items-center rounded-pill border border-line px-3 text-[12px] text-ink-2"
          >
            Retry
          </button>
        </div>
      ) : credits === null ? (
        <p className="mt-2.5 text-[13px] text-ink-3">Loading…</p>
      ) : (
        <div className="mt-2.5 space-y-3">
          {credits.length === 0 ? (
            <p className="text-[13px] text-ink-3">
              {canGrant
                ? "No makeup credits yet. Excuse an absence below to grant one."
                : "No makeup credits yet."}
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {credits.map((c) => (
                <li
                  key={c.creditId}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-medium">
                      {formatDateIST(c.sourceDate)}
                    </p>
                    <p className="text-[11.5px] text-ink-3">
                      expires {formatDateIST(c.expiresAt)}
                    </p>
                  </div>
                  <span className="flex-none rounded-pill bg-deck px-2.5 py-1 text-[11px] font-medium text-ink-2">
                    {STATUS_LABEL[c.status] ?? c.status}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {canGrant ? (
            sources.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2">
                {/* P2 (independent review) — the flex sizing lives on a
                    lane-owned wrapper around the shared primitive. */}
                <div className="min-w-0 flex-1">
                  <Select
                    value={sourcePick}
                    onChange={(e) => setSourcePick(e.target.value)}
                    data-testid="makeup-source"
                    aria-label="Excused absence"
                  >
                    {sources.map((s) => (
                      <option key={s.sessionId} value={s.sessionId}>
                        {formatDateIST(s.sessionDate)} — {s.batchName}
                      </option>
                    ))}
                  </Select>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    run(() =>
                      grantMakeupCreditAction({
                        memberId,
                        sourceSessionId: sourcePick,
                      }),
                    )
                  }
                  disabled={busy || !sourcePick}
                  className="rounded-ctl bg-[var(--accent-strong)] px-3.5 min-h-[44px] text-[13px] font-medium text-white disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Grant credit"}
                </button>
              </div>
            ) : (
              <p className="text-[12px] text-ink-3">
                No unexcused absences to grant from.
              </p>
            )
          ) : (
            <p className="text-[12px] text-ink-3">
              Ask the owner to grant a makeup credit.
            </p>
          )}

          {available.length > 0 && targets.length > 0 ? (
            canRedeem ? (
              <div className="flex flex-wrap items-center gap-2">
                <div className="min-w-0 flex-1">
                  <Select
                    value={targetPick}
                    onChange={(e) => setTargetPick(e.target.value)}
                    data-testid="makeup-target"
                    aria-label="Makeup session"
                  >
                    {targets.map((t) => (
                      <option key={t.sessionId} value={t.sessionId}>
                        {formatDateIST(t.sessionDate)} — {t.batchName}
                      </option>
                    ))}
                  </Select>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    run(() =>
                      redeemMakeupCreditAction({
                        memberId,
                        sourceSessionId: available[0]!.sourceSessionId,
                        targetSessionId: targetPick,
                      }),
                    )
                  }
                  disabled={busy || !targetPick}
                  className="rounded-ctl border border-line bg-deck px-3.5 min-h-[44px] text-[13px] font-medium text-ink-2 disabled:opacity-50"
                >
                  {busy ? "Saving…" : "Redeem"}
                </button>
              </div>
            ) : (
              <p className="text-[12px] text-ink-3">
                A coach or the front desk records the makeup attendance.
              </p>
            )
          ) : null}

          {error ? <p className="text-[12px] text-ink-2">{error}</p> : null}
        </div>
      )}
    </section>
  );
}
