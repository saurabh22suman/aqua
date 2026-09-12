import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// P1-1 / P1-7 (mobile UX audit, 2026-09-12) — the mechanical half of
// the date/time sweep. Every surface named by the audit must route
// through lib/time/tz, and no app/ or components/ file may call
// `toLocaleString("en-IN")` by hand (the pre-fix enquiry follow-up
// rendered `10/9/2026, 5:30:00 am` that way).
//
// Mutation proof: reverting any listed file to its local formatter
// turns the corresponding assertion red.

const ROOT = process.cwd();

const MUST_IMPORT_HELPERS = [
  "app/(coach)/coach/page.tsx",
  "app/(coach)/coach/schedule/page.tsx",
  "app/(auth)/login/link/[token]/page.tsx",
  "app/(owner)/owner/reports/page.tsx",
  "app/(owner)/owner/staff/[staffId]/page.tsx",
  "components/enquiry-detail-view.tsx",
  "components/invitations-board.tsx",
  "components/parent-link-panel.tsx",
  "components/programs-batches-board.tsx",
  "components/owner-dashboard.tsx",
];

const BANNED_SNIPPETS: Record<string, string> = {
  "app/(coach)/coach/page.tsx": "{next.sessionDate}",
  "components/programs-batches-board.tsx": "{b.startTime}–{b.endTime}",
  "app/(owner)/owner/reports/page.tsx": "<span className=\"font-mono\">{period.from}</span>",
};

function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir))) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(ROOT, dir, entry);
    if (statSync(full).isDirectory()) walk(join(dir, entry), out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(join(dir, entry));
  }
  return out;
}

describe("date/time display sweep (P1-1, P1-7)", () => {
  it("every audited surface imports the shared helpers", () => {
    const missing = MUST_IMPORT_HELPERS.filter(
      (rel) => !read(rel).includes('from "@/lib/time/tz"'),
    );
    expect(missing, `still formatting dates/times locally:\n${missing.join("\n")}`).toEqual([]);
  });

  it("no hand-rolled toLocaleString('en-IN') remains", () => {
    const hits: string[] = [];
    for (const file of [...walk("app"), ...walk("components")]) {
      if (read(file).includes('toLocaleString("en-IN"')) hits.push(file);
    }
    expect(hits, `hand-rolled datetime display:\n${hits.join("\n")}`).toEqual([]);
  });

  it("keeps the specific raw-value renders out of the audited screens", () => {
    const hits: string[] = [];
    for (const [rel, snippet] of Object.entries(BANNED_SNIPPETS)) {
      if (read(rel).includes(snippet)) hits.push(`${rel} still renders ${snippet}`);
    }
    expect(hits).toEqual([]);
  });
});
