"use client";

import { useEffect, useRef } from "react";

const KEY = "__aqua_member_draft_guard_v1";
const activeNonces = new Set<string>();
type Phase = "idle" | "armed" | "restoring" | "leaving" | "discarding" | "done";
type Marker = { nonce: string; entry: "base" | "sentinel" };

function marker(state: unknown): Marker | null {
  if (!state || typeof state !== "object" || !(KEY in state)) return null;
  const value = state[KEY];
  if (!value || typeof value !== "object" || !("nonce" in value) || !("entry" in value)) return null;
  return typeof value.nonce === "string" && (value.entry === "base" || value.entry === "sentinel")
    ? { nonce: value.nonce, entry: value.entry } : null;
}
function stateWith(value: Marker | null) {
  const state = window.history.state;
  const copy: Record<string, unknown> = state && typeof state === "object" && !Array.isArray(state) ? {...state} : {};
  if (value) copy[KEY] = value;
  else delete copy[KEY];
  return copy;
}

/** Guard only our same-URL history pair. Cross-document exits use beforeunload. */
export function useUnsavedHistoryGuard(dirty: boolean, busy: boolean, onBack: () => void) {
  const phase = useRef<Phase>("idle");
  const nonce = useRef("");
  const url = useRef("");
  const busyRef = useRef(busy);
  const dirtyRef = useRef(dirty);
  const backRef = useRef(onBack);
  const afterLeave = useRef<(() => void) | null>(null);
  busyRef.current = busy;
  dirtyRef.current = dirty;
  backRef.current = onBack;

  function arm() {
    const existing = marker(window.history.state);
    if (existing && activeNonces.has(existing.nonce)) return;
    if (existing) window.history.replaceState(stateWith(null), "", window.location.href);
    nonce.current = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    activeNonces.add(nonce.current);
    url.current = window.location.href;
    window.history.replaceState(stateWith({nonce:nonce.current,entry:"base"}), "", url.current);
    window.history.pushState(stateWith({nonce:nonce.current,entry:"sentinel"}), "", url.current);
    phase.current = "armed";
  }

  useEffect(() => {
    // React may probe mount cleanup in development; a fresh listener can arm again.
    if (phase.current === "done") phase.current = "idle";
    function onPop(event: PopStateEvent) {
      const found = marker(event.state);
      if (!nonce.current || found?.nonce !== nonce.current || window.location.href !== url.current) {
        activeNonces.delete(nonce.current);
        phase.current = "done";
        return; // A different entry is never intercepted.
      }
      if (phase.current === "armed" && found.entry === "base") {
        event.stopImmediatePropagation();
        phase.current = "restoring";
        window.history.forward();
      } else if (phase.current === "restoring" && found.entry === "sentinel") {
        event.stopImmediatePropagation();
        phase.current = "armed";
        if (!busyRef.current) backRef.current();
      } else if ((phase.current === "leaving" || phase.current === "discarding") && found.entry === "base") {
        event.stopImmediatePropagation();
        const discard = phase.current === "discarding";
        window.history.replaceState(stateWith(null), "", window.location.href);
        activeNonces.delete(nonce.current);
        phase.current = "done";
        if (discard) window.history.back();
        else {
          const callback = afterLeave.current;
          afterLeave.current = null;
          if (callback) callback();
          else { phase.current = "idle"; if (dirtyRef.current) arm(); }
        }
      }
    }
    window.addEventListener("popstate", onPop, true);
    return () => {
      window.removeEventListener("popstate", onPop, true);
      const current = marker(window.history.state);
      if (current?.nonce === nonce.current && window.location.href === url.current) {
        window.history.replaceState(stateWith(null), "", window.location.href);
      }
      activeNonces.delete(nonce.current);
      phase.current = "done";
    };
  }, []);

  useEffect(() => {
    if (dirty && phase.current === "idle") {
      arm();
    } else if (!dirty && phase.current === "armed") {
      phase.current = "leaving";
      window.history.back();
    }
  }, [dirty]);

  function leave(callback: () => void) {
    const current = marker(window.history.state);
    if (phase.current === "armed" && current?.nonce === nonce.current && current.entry === "sentinel") {
      afterLeave.current = callback;
      phase.current = "leaving";
      window.history.back();
    } else callback();
  }
  function discardBack() {
    const current = marker(window.history.state);
    if (phase.current === "armed" && current?.nonce === nonce.current && current.entry === "sentinel") {
      phase.current = "discarding";
      window.history.back();
    }
  }
  return { leave, discardBack };
}
