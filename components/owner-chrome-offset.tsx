"use client";

import { useEffect } from "react";

// The preview notice scrolls with the document; the demo notice is sticky.
// Reserve only their currently visible height, locally to the owner shell.
// RootLayout stays server-only, including on zero-JS parent pages.
export function OwnerChromeOffset() {
  useEffect(() => {
    const shell = document.querySelector<HTMLElement>('[data-testid="owner-shell"]');
    const preview = document.querySelector<HTMLElement>('[data-testid="preview-banner"]');
    if (!shell || !preview) return;
    const demo = document.querySelector<HTMLElement>('[data-testid="demo-banner"]');
    const previous = shell.style.getPropertyValue("--app-sticky-offset");
    let published = "";
    let frame = 0;
    const publish = () => {
      frame = 0;
      const bottom = Math.max(0, preview.getBoundingClientRect().bottom,
        demo?.getBoundingClientRect().bottom ?? 0);
      const value = `${Math.min(window.innerHeight, bottom)}px`;
      if (value === published) return;
      published = value;
      shell.style.setProperty("--app-sticky-offset", value);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(publish);
    };
    publish();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    observer?.observe(preview);
    if (demo) observer?.observe(demo);
    return () => {
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      if (frame) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      if (shell.style.getPropertyValue("--app-sticky-offset") === published) {
        if (previous) shell.style.setProperty("--app-sticky-offset", previous);
        else shell.style.removeProperty("--app-sticky-offset");
      }
    };
  }, []);
  return null;
}
