"use client";

export function OpenWorkspaceGuideLink({ homeHref }: { homeHref: string }) {
  return <a href={`${homeHref}#workspace-guide`} data-guide-help-trigger className="inline-flex min-h-11 items-center text-[13px] font-medium text-[var(--accent-ink)] underline underline-offset-2" onClick={(event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (window.location.pathname === homeHref) { event.preventDefault(); window.dispatchEvent(new Event("aqua:open-workspace-guide")); }
  }}>Help: open guide</a>;
}
export const GuideHelpButton = OpenWorkspaceGuideLink;
