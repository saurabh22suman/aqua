"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { SkeletonLine } from "@/components/skeleton";
import { globalSearchAction } from "@/lib/actions/global-search";
import type {
  GlobalSearchHit,
  GlobalSearchKind,
} from "@/lib/services/global-search";

// U-05 — global search box. Rendered by the owner shell (U-10) in the
// top bar and the sticky mobile header; the action decides what the
// caller may see (permission + tenant + location scope), this
// component only renders what came back. Deep links come from the
// action, so the box does not need to know the surface's base path.

const KIND_LABEL: Record<GlobalSearchKind, string> = {
  member: "Members",
  enquiry: "Enquiries",
  payment: "Payments",
};

const KIND_ORDER: GlobalSearchKind[] = ["member", "enquiry", "payment"];

export type GlobalSearchAction = (query: string) => Promise<GlobalSearchHit[]>;

export function GlobalSearch({
  searchAction = globalSearchAction,
}: {
  searchAction?: GlobalSearchAction;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<GlobalSearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = query.trim();
    if (q.length < 2 || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      setHits(await searchAction(q));
    } catch {
      setHits([]);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  function clear() {
    setQuery("");
    setHits(null);
    setFailed(false);
  }

  const open = busy || hits !== null;

  return (
    <div className="relative">
      <form role="search" onSubmit={onSubmit}>
        <label className="block">
          <span className="sr-only">Search</span>
          <Search
            size={16}
            className="pointer-events-none absolute left-3.5 top-[22px] -translate-y-1/2 text-ink-3"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search members, enquiries, payments"
            autoComplete="off"
            data-testid="global-search-input"
            className="w-full min-h-[44px] rounded-ctl border border-line bg-paper pl-10 pr-11 text-[16px] text-ink"
          />
        </label>
        {query.length > 0 ? (
          <button
            type="button"
            onClick={clear}
            aria-label="Clear search"
            className="absolute right-0 top-0 grid h-11 w-11 place-items-center text-ink-3"
          >
            <X size={16} aria-hidden="true" />
          </button>
        ) : null}
      </form>

      {open ? (
        <div
          data-testid="global-search-results"
          aria-live="polite"
          className="absolute inset-x-0 top-full z-40 mt-2 max-h-[70vh] overflow-y-auto rounded-card border border-line bg-paper shadow-2"
        >
          {busy ? (
            <div className="px-4 py-4" data-testid="global-search-loading">
              <SkeletonLine count={3} width={40} />
            </div>
          ) : failed ? (
            <p role="alert" className="px-4 py-4 text-[13px] text-ink-2">
              Search is unavailable right now. Try again in a moment.
            </p>
          ) : hits !== null && hits.length === 0 ? (
            <p className="px-4 py-4 text-[13px] text-ink-2">
              No matches for &ldquo;{query.trim()}&rdquo;.
            </p>
          ) : (
            <ul className="divide-y divide-line">
              {KIND_ORDER.flatMap((kind) => {
                const kindHits = (hits ?? []).filter((h) => h.kind === kind);
                if (kindHits.length === 0) return [];
                return [
                  <li key={`group-${kind}`}>
                    <p className="px-4 pt-3 pb-1 text-[11px] font-medium uppercase tracking-wide text-ink-3">
                      {KIND_LABEL[kind]}
                    </p>
                    <ul>
                      {kindHits.map((hit) => (
                        <li key={`${hit.kind}-${hit.id}`}>
                          <Link
                            href={hit.href}
                            onClick={clear}
                            data-testid={`global-search-hit-${hit.kind}`}
                            className="block min-h-[44px] px-4 py-2.5 transition-colors duration-150 hover:bg-deck"
                          >
                            <p className="text-[14px] font-medium text-ink truncate">
                              {hit.title}
                            </p>
                            <p className="mt-0.5 text-[12px] text-ink-3 truncate">
                              {hit.subtitle}
                            </p>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </li>,
                ];
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
