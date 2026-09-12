"use client";

import { useEffect, useState } from "react";
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

// R.7 (docs/five-day-work-guide.md) — makeup credits on the member
// detail page. Grant from an excused absence; redeem against another
// session in the member's batches. One free session per absence — no
// fee credit, no subscription adjustment (the service enforces the
// same rule).
const STATUS_LABEL: Record<string, string> = {
  granted: "Available",
  redeemed: "Redeemed",
  expired: "Expired",
};

export function MakeupCreditsPanel({ memberId }: { memberId: string }) {
  const router = useRouter();
  const [credits, setCredits] = useState<MakeupCreditRow[] | null>(null);
  const [sources, setSources] = useState<MakeupSessionOption[]>([]);
  const [targets, setTargets] = useState<MakeupSessionOption[]>([]);
  const [sourcePick, setSourcePick] = useState("");
  const [targetPick, setTargetPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setError(null);
    try {
      const [c, s, t] = await Promise.all([
        listMakeupCreditsAction(memberId),
        listMakeupSourcesAction(memberId),
        listMakeupTargetsAction(memberId),
      ]);
      setCredits(c);
      setSources(s);
      setTargets(t);
      setSourcePick(s[0]?.sessionId ?? "");
      setTargetPick(t[0]?.sessionId ?? "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load makeup credits.");
      setCredits([]);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId]);

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

      {credits === null ? (
        <p className="mt-2.5 text-[13px] text-ink-3">Loading…</p>
      ) : (
        <div className="mt-2.5 space-y-3">
          {credits.length === 0 ? (
            <p className="text-[13px] text-ink-3">
              No makeup credits yet. Excuse an absence below to grant one.
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

          {sources.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={sourcePick}
                onChange={(e) => setSourcePick(e.target.value)}
                className="min-w-0 flex-1 rounded-ctl border border-line bg-deck px-3 py-2 text-[16px]"
                data-testid="makeup-source"
                aria-label="Excused absence"
              >
                {sources.map((s) => (
                  <option key={s.sessionId} value={s.sessionId}>
                    {formatDateIST(s.sessionDate)} — {s.batchName}
                  </option>
                ))}
              </select>
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
                className="rounded-ctl bg-[var(--accent)] px-3.5 min-h-[44px] text-[13px] font-medium text-white disabled:opacity-50"
              >
                {busy ? "Saving…" : "Grant credit"}
              </button>
            </div>
          ) : (
            <p className="text-[12px] text-ink-3">
              No unexcused absences to grant from.
            </p>
          )}

          {available.length > 0 && targets.length > 0 ? (
            <div className="flex flex-wrap items-center gap-2">
              <select
                value={targetPick}
                onChange={(e) => setTargetPick(e.target.value)}
                className="min-w-0 flex-1 rounded-ctl border border-line bg-deck px-3 py-2 text-[16px]"
                data-testid="makeup-target"
                aria-label="Makeup session"
              >
                {targets.map((t) => (
                  <option key={t.sessionId} value={t.sessionId}>
                    {formatDateIST(t.sessionDate)} — {t.batchName}
                  </option>
                ))}
              </select>
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
          ) : null}

          {error ? <p className="text-[12px] text-ink-2">{error}</p> : null}
        </div>
      )}
    </section>
  );
}
