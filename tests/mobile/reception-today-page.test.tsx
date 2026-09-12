import { describe, expect, it, vi } from "vitest";

// F5 (mobile UX plan v2, Phase 0) — reception's Today card linked to
// /coach/register/[sessionId], a coach-only page, so every tap in the
// receptionist's primary screen landed on a 404. /reception is a
// reception-only route (requireReception), so the card should never be
// a link at all: it renders a static "Coach will mark attendance."
// line instead.
//
// Tree walk instead of a DOM render: the page returns React elements
// (server component) and we need to assert BOTH the absence of a
// /coach/register href and the presence of the new copy — walking
// props is more direct than mounting next/link outside an app-router
// context.

vi.mock("@/lib/auth/surface-guard", () => ({
  requireReception: async () => ({}),
}));

const getTodayAction = vi.fn();
vi.mock("@/lib/actions/coach", () => ({
  getTodayAction: (...args: unknown[]) => getTodayAction(...args),
}));

import ReceptionTodayPage from "@/app/(reception)/reception/page";

const SESSIONS = [
  {
    id: "s1",
    startsAt: "2026-09-12T01:30:00.000Z",
    batchName: "Junior TTS",
    marked: 2,
    total: 16,
  },
];

type AnyNode = unknown;

function walk(
  node: AnyNode,
  visit: (props: Record<string, unknown>, type: unknown) => void,
): void {
  if (node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit);
    return;
  }
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (el.props) {
    visit(el.props, el.type);
    if (el.props.children !== undefined) walk(el.props.children, visit);
  }
}

function collectHrefs(node: AnyNode): string[] {
  const hrefs: string[] = [];
  walk(node, (props) => {
    if (typeof props.href === "string") hrefs.push(props.href);
  });
  return hrefs;
}

function collectText(node: AnyNode): string {
  let text = "";
  const visit = (n: AnyNode): void => {
    if (n == null || typeof n === "boolean") return;
    if (typeof n === "string" || typeof n === "number") {
      text += String(n);
      return;
    }
    if (Array.isArray(n)) {
      for (const child of n) visit(child);
      return;
    }
    const el = n as { props?: Record<string, unknown> };
    if (el.props?.children !== undefined) visit(el.props.children);
  };
  visit(node);
  return text;
}

describe("ReceptionTodayPage — today card is not a coach link (F5)", () => {
  it("contains no /coach/register href and states who marks attendance", async () => {
    getTodayAction.mockResolvedValue({ sessions: SESSIONS });

    const result = await ReceptionTodayPage();
    const hrefs = collectHrefs(result);
    const text = collectText(result);

    expect(hrefs.some((h) => h.startsWith("/coach/register/"))).toBe(false);
    expect(text).toContain("Coach will mark attendance.");
    // The operational data stays: batch name and counted figures.
    expect(text).toContain("Junior TTS");
    expect(text).toContain("2");
    expect(text).toContain("16");
  });
});
