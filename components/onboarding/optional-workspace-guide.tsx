"use client";

import { useEffect, useRef, useState } from "react";
import { Button, buttonClasses } from "@/components/ui/Button";

type GuideItem = { key: string; title: string; detail: string; complete?: boolean };

/** Optional, page-local guidance: it never performs setup actions. */
export function OptionalWorkspaceGuide({
  items,
  title = "A little help getting started",
  intro = "Take a quick look at your available register checks. You can skip this and come back anytime on this page.",
  regionLabel = "Optional register guide",
  itemLabel = "Register check",
  startCollapsed = false,
}: {
  items: GuideItem[];
  title?: string;
  intro?: string;
  regionLabel?: string;
  itemLabel?: string;
  startCollapsed?: boolean;
}) {
  const [mode, setMode] = useState<"intro" | "steps" | "closed">(startCollapsed ? "closed" : "intro");
  const [index, setIndex] = useState(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const reopenRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (mode === "steps") headingRef.current?.focus();
    if (mode === "closed" && returnFocus.current) {
      reopenRef.current?.focus();
      returnFocus.current = false;
    }
  }, [mode, index]);

  const close = () => {
    returnFocus.current = true;
    setMode("closed");
  };
  const start = () => {
    setIndex(0);
    setMode("steps");
  };
  const item = items[index];

  if (mode === "closed") {
    return <div className="mt-4"><button type="button" ref={reopenRef} onClick={start} className={buttonClasses({ size: "sm" })}>Show me around</button></div>;
  }

  return (
    <section
      aria-label={regionLabel}
      className="mt-4 max-w-2xl rounded-card border border-line bg-paper p-4 sm:p-5"
      onKeyDown={(event) => { if (event.key === "Escape") close(); }}
    >
      <div className="flex items-start gap-4">
        <div aria-hidden="true" className="w-14 shrink-0 sm:w-20">
          {/* Existing pre-optimised local artwork, sized for this inline surface. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/login/art/welcome-coach.webp" alt="" width={720} height={480} decoding="async" className="h-auto w-full" />
        </div>
        <div className="min-w-0 flex-1">
          {mode === "intro" || !item ? (
            <>
              <h2 className="font-display text-base font-semibold">{title}</h2>
              <p className="mt-1 text-sm text-ink-2">{intro}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={start} size="sm">Show me around</Button>
                <Button onClick={close} variant="ghost" size="sm">Skip for now</Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-ink-2">{itemLabel} {index + 1} of {items.length}{item.complete === undefined ? "" : item.complete ? " · Done" : " · Not yet complete"}</p>
              <h2 ref={headingRef} tabIndex={-1} className="mt-1 font-display text-base font-semibold">{item.title}</h2>
              <p className="mt-1 text-sm text-ink-2">{item.detail}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {index > 0 && <Button onClick={() => setIndex(index - 1)} size="sm">Back</Button>}
                {index + 1 < items.length ? (
                  <Button onClick={() => setIndex(index + 1)} size="sm">Next</Button>
                ) : (
                  <Button onClick={close} size="sm">Finish guide</Button>
                )}
                <Button onClick={close} variant="ghost" size="sm">Close guide</Button>
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
