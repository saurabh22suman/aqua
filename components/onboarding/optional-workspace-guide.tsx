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
  preferenceKey,
}: {
  items: GuideItem[];
  title?: string;
  intro?: string;
  regionLabel?: string;
  itemLabel?: string;
  startCollapsed?: boolean;
  preferenceKey?: string;
}) {
  const [mode, setMode] = useState<"intro" | "steps" | "closed" | "retired" | "pending">(preferenceKey ? "pending" : startCollapsed ? "closed" : "intro");
  const [index, setIndex] = useState(0);
  const [storageError, setStorageError] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const reopenRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);
  const retired = useRef(false);

  useEffect(() => {
    retired.current = false;
    try {
      if (preferenceKey && localStorage.getItem(`aqua:guide:${preferenceKey}`) === "dismissed") {
        retired.current = true; setMode("retired");
      } else setMode(startCollapsed ? "closed" : "intro");
    } catch { setStorageError(true); setMode(startCollapsed ? "closed" : "intro"); }
  }, [preferenceKey, startCollapsed]);

  useEffect(() => {
    const open = () => { setIndex(0); setMode("steps"); };
    window.addEventListener("aqua:open-workspace-guide", open);
    if (window.location.hash === "#workspace-guide") {
      open();
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
    }
    return () => window.removeEventListener("aqua:open-workspace-guide", open);
  }, []);

  useEffect(() => {
    if (mode === "steps") headingRef.current?.focus();
    if (mode === "closed" && returnFocus.current) {
      reopenRef.current?.focus();
      returnFocus.current = false;
    }
    if (mode === "retired" && returnFocus.current) {
      const target = document.querySelector<HTMLElement>("main h1");
      if (target && !target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target?.focus(); returnFocus.current = false;
    }
  }, [mode, index]);

  const close = () => {
    returnFocus.current = true;
    setMode(retired.current ? "retired" : "closed");
  };
  const retire = () => {
    if (!preferenceKey) return;
    try { localStorage.setItem(`aqua:guide:${preferenceKey}`, "dismissed"); retired.current = true; setStorageError(false); close(); }
    catch { setStorageError(true); }
  };
  const start = () => {
    setIndex(0);
    setMode("steps");
  };
  const item = items[index];

  if (mode === "retired" || mode === "pending") return null;
  if (mode === "closed") {
    return <div className="mt-4"><button type="button" ref={reopenRef} onClick={start} className={buttonClasses({ size: "sm" })}>Show me around</button>{preferenceKey ? <Button onClick={retire} variant="ghost" size="sm">Don’t show again</Button> : null}{storageError ? <p role="alert">Could not save this preference on this device.</p> : null}</div>;
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
                {preferenceKey ? <Button onClick={retire} variant="ghost" size="sm">Don’t show again</Button> : null}
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
                {preferenceKey ? <Button onClick={retire} variant="ghost" size="sm">Don’t show again</Button> : null}
              </div>
            </>
          )}
          {storageError ? <p role="alert">Could not save this preference on this device.</p> : null}
        </div>
      </div>
    </section>
  );
}
