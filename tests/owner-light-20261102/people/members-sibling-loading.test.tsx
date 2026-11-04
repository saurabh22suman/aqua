// @vitest-environment jsdom
//
// Owner light · People lane (3 November 2026; profile fallback revised
// 4 November 2026) — the members SIBLING fallbacks (independent review F1).
//
// Deleting the nearest `members/loading.tsx` moved the profile, the edit page
// and ALSO `members/new` and `members/import` onto the owner segment fallback,
// which is the HOME composition (hero + timeline) — a wrong shape painted under
// an add-member form or an import screen. The correction gives those two routes
// their own sibling `loading.tsx`.
//
// 4 November 2026: the profile resolves its overview data before returning JSX,
// so the profile and its edit route now use `[memberId]/loading.tsx` — a member
// shape, still never the HOME composition. That is asserted in the control
// below; the experiment's one-nearest-boundary claim no longer applies to the
// profile, and this file says so rather than pinning a stale owner/loading file.
//
// This regression does not assert a filename: it RESOLVES the nearest existing
// `loading.tsx` for each route the way the framework does (walking up the
// segment chain), renders that component, and checks the real fallback
// semantics. Before the sibling files existed the nearest file for both routes
// was `owner/loading.tsx`, so the rendered output had no busy form shape and
// carried the HOME hero/timeline — a genuine wrong-shape RED.

import { cleanup, render, screen } from "@testing-library/react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ComponentType } from "react";
import { afterEach, describe, expect, it } from "vitest";

afterEach(cleanup);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OWNER_SEGMENT = path.resolve(HERE, "../../../app/(owner)/owner");

// The route group `(owner)` is an extglob to the matcher, so the glob is taken
// over the whole app tree and the resolver below compares RESOLVED paths.
const LOADINGS = import.meta.glob("../../../app/**/loading.tsx", {
  eager: true,
}) as Record<string, { default: ComponentType }>;

/**
 * The nearest loading file for a route, resolved the way the framework walks
 * the segment chain: the route's own segment first, then each ancestor.
 */
function nearestLoading(segments: string[]) {
  const entries = Object.entries(LOADINGS).map(
    ([key, mod]) => [path.resolve(HERE, key), mod] as const,
  );
  for (let depth = segments.length; depth >= 0; depth -= 1) {
    const candidate = path.join(
      OWNER_SEGMENT,
      ...segments.slice(0, depth),
      "loading.tsx",
    );
    const hit = entries.find(([file]) => file === candidate);
    if (hit) return { file: hit[0], Component: hit[1].default };
  }
  return null;
}

function renderNearest(segments: string[]) {
  const nearest = nearestLoading(segments);
  expect(nearest, `no loading file above ${segments.join("/")}`).not.toBeNull();
  const Nearest = nearest!.Component;
  return { file: nearest!.file, ...render(<Nearest />) };
}

describe("the members new/import fallbacks", () => {
  // RED: the nearest file was owner/loading.tsx (the HOME composition).
  it("paints a member-form fallback for the add-member route", () => {
    const { file, container } = renderNearest(["members", "new"]);
    // The rendered fallback first: the HOME composition has no busy status.
    const status = screen.getByRole("status");
    expect(file.endsWith(path.join("members", "new", "loading.tsx"))).toBe(true);
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(status.textContent).toMatch(/loading the member form/i);
    // The HOME composition must never stand in for this task.
    expect(container.querySelector('[data-testid^="owner-home-loading"]')).toBeNull();
    expect(screen.queryByTestId("members-list")).toBeNull();
  });

  // RED: the same wrong ancestor fallback for the import route.
  it("paints a file-import fallback for the import route", () => {
    const { file, container } = renderNearest(["members", "import"]);
    const status = screen.getByRole("status");
    expect(file.endsWith(path.join("members", "import", "loading.tsx"))).toBe(true);
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(status.textContent).toMatch(/loading the import/i);
    expect(container.querySelector('[data-testid^="owner-home-loading"]')).toBeNull();
    expect(screen.queryByTestId("members-list")).toBeNull();
  });

  // CONTROL: the profile and its edit route now share the member segment's own
  // fallback (4 November 2026) — a member shape, never the HOME composition and
  // never directory rows.
  it("paints the member fallback for the profile and edit routes", () => {
    for (const segments of [["members", "[memberId]"], ["members", "[memberId]", "edit"]]) {
      cleanup();
      const { file, container } = renderNearest(segments);
      expect(file.endsWith(path.join("[memberId]", "loading.tsx"))).toBe(true);
      const status = screen.getByRole("status");
      expect(status.getAttribute("aria-busy")).toBe("true");
      expect(status.textContent).toMatch(/loading details/i);
      expect(container.querySelector('[data-testid^="owner-home-loading"]')).toBeNull();
      expect(screen.queryByTestId("members-list")).toBeNull();
    }
  });
});
