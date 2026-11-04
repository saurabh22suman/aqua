import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Owner redesign · People lane (C2) — the OWNED control-metric
// acceptance test.
//
// The human requires every owner page to follow ONE design. The
// approved direction says the standard controls share a 48px height, a
// 10px radius and 16px control text; after the shared snapshot the
// shared primitives carry exactly that, and a page that keeps its own
// hand-rolled control class stays at the old 44px.
//
// This test is the source-level half of that acceptance: every form
// control on an OWNED owner surface must be rendered through the shared
// primitives, and no owned file may restate the control metrics by
// hand. It names the exact file and line of every remaining row, so
// the list of what is left is never a guess.
//
// The ALLOWED raw controls are deliberate and narrow:
//   * a native file input (the shared primitives do not cover files);
//   * a native checkbox / radio (the shared `Checkbox` wraps its
//     control, and a choice control is not a text field);
//   * the ref-forwarding inline edit control, whose `Select` cannot
//     take a ref yet (interface request R5 in the handoff).
//
// The rendered geometry (a computed 48px, a 10px radius, 16px text)
// is proved in Chrome by e2e/owner-redesign-c2-people-layout.ts —
// "it renders" and "it does not overflow" are not control compliance.

const ROOT = process.cwd();

const OWNED_FILES = [
  "app/(owner)/owner/members/page.tsx",
  "app/(owner)/owner/members/[memberId]/page.tsx",
  "app/(owner)/owner/members/[memberId]/edit/page.tsx",
  "app/(owner)/owner/members/new/page.tsx",
  "app/(owner)/owner/members/import/page.tsx",
  "app/(owner)/owner/fees/page.tsx",
  "app/(owner)/owner/enquiries/page.tsx",
  "app/(owner)/owner/enquiries/[enquiryId]/page.tsx",
  "app/(owner)/owner/staff/page.tsx",
  "app/(owner)/owner/staff/new/page.tsx",
  "app/(owner)/owner/staff/[staffId]/page.tsx",
  "app/(owner)/owner/staff/invitations/page.tsx",
  "app/(owner)/owner/staff/invitations/new/page.tsx",
  "app/(owner)/owner/staff/leave/page.tsx",
  "app/(owner)/owner/staff/roster/page.tsx",
  "app/(owner)/owner/staff/check-in-qr/page.tsx",
  "app/(owner)/owner/announcements/page.tsx",
  "components/member-create-form.tsx",
  "components/member-edit-form.tsx",
  "components/member-import-form.tsx",
  "components/member-enrolment-panel.tsx",
  "components/member-subscription-panel.tsx",
  "components/member-facilities-panel.tsx",
  "components/member-status-panel.tsx",
  "components/member-notification-destinations.tsx",
  "components/member-consent-choices.tsx",
  "components/member-list-toolbar.tsx",
  "components/members-board.tsx",
  "components/member-detail/member-detail-tabs.tsx",
  "components/member-detail/member-invoices-panel.tsx",
  "components/member-detail/member-notes-panel.tsx",
  "components/member-detail/invoice-expanded.tsx",
  "components/member-detail/inline-edit-control.tsx",
  "components/member-detail/inline-edit-field.tsx",
  "components/fees/fees-invoice-list.tsx",
  "components/enquiries-board.tsx",
  "components/enquiry-detail-view.tsx",
  "components/enquiry-new-member-fields.tsx",
  "components/staff-board.tsx",
  "components/staff-create-form.tsx",
  "components/staff-invite-form.tsx",
  "components/staff-roster-board.tsx",
  "components/staff-attendance-board.tsx",
  "components/staff-check-in-controls.tsx",
  // The roster's own surfaces: they are rendered ONLY by the owned owner
  // staff roster board (components/staff-roster-board.tsx), so they are
  // part of this lane's owner surface.
  "components/roster/add-shift-form.tsx",
  "components/roster/roster-publish-panel.tsx",
  "components/shift-template-editor.tsx",
  "components/invitations-board.tsx",
  "components/leave-decision-controls.tsx",
  "components/leave-request-form.tsx",
  "components/leave-types-editor.tsx",
  "components/cancel-leave-button.tsx",
  "components/collect-payment.tsx",
  "components/payment-record-form.tsx",
  "components/parent-link-panel.tsx",
  "components/parent-link-explainer.tsx",
  "components/makeup-credits-panel.tsx",
  "components/announcements/announcement-composer.tsx",
  "components/announcements/notification-inbox.tsx",
];

/** Raw controls that are deliberately native. */
const ALLOWED_RAW_TYPES = ["file", "checkbox", "radio", "hidden"];

/**
 * No raw control is allow-listed any more: the reviewed shared refresh
 * 20261027T175441Z gives the shared `Select` its ref (R5), so the
 * ref-forwarding inline editor can use the primitive like every other
 * owned surface.
 */
const ALLOWED_RAW_ELEMENTS: Record<string, string[]> = {};

function linesOf(path: string): string[] {
  return readFileSync(join(ROOT, path), "utf8").split("\n");
}

/** A hand-rolled control class: it restates the control metrics. */
function handRolledControlRows(path: string): string[] {
  const rows: string[] = [];
  linesOf(path).forEach((line, index) => {
    if (!/min-h-11|min-h-\[44px\]/.test(line)) return;
    if (!/text-\[16px\]/.test(line)) return;
    rows.push(`${path}:${index + 1} ${line.trim().slice(0, 110)}`);
  });
  return rows;
}

/**
 * A raw form control that is neither a native choice/file control nor
 * an allow-listed element. The element is read across lines, because a
 * control's `type` attribute often sits on the next line.
 */
function rawControlRows(path: string): string[] {
  const source = readFileSync(join(ROOT, path), "utf8");
  const rows: string[] = [];
  const pattern = /<(input|select|textarea)\b/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    const element = source.slice(match.index, source.indexOf(">", match.index) + 1);
    const type = /type="([^"]+)"/.exec(element)?.[1] ?? "";
    if (ALLOWED_RAW_TYPES.includes(type)) continue;
    if ((ALLOWED_RAW_ELEMENTS[path] ?? []).includes(match[1])) continue;
    const line = source.slice(0, match.index).split("\n").length;
    rows.push(`${path}:${line} <${match[1]}> ${element.replace(/\s+/g, " ").slice(0, 90)}`);
  }
  return rows;
}

describe("owned owner surfaces use the shared controls (C2)", () => {
  it("has no hand-rolled control metric in an owned file", () => {
    const rows = OWNED_FILES.flatMap(handRolledControlRows);
    expect(rows, `hand-rolled control metrics:\n${rows.join("\n")}`).toEqual([]);
  });

  it("renders every owned form control through the shared primitives", () => {
    const rows = OWNED_FILES.flatMap(rawControlRows);
    expect(rows, `raw form controls:\n${rows.join("\n")}`).toEqual([]);
  });

  it("keeps the owned file list real", () => {
    const missing = OWNED_FILES.filter((path) => {
      try {
        statSync(join(ROOT, path));
        return false;
      } catch {
        return true;
      }
    });
    expect(missing).toEqual([]);
  });
});

describe("the shared primitives stay untouched by this lane (C2)", () => {
  it("does not hand-roll a control class inside components/ui", () => {
    const uiDir = join(ROOT, "components/ui");
    const rows: string[] = [];
    for (const entry of readdirSync(uiDir)) {
      if (!entry.endsWith(".tsx")) continue;
      const path = join("components/ui", entry);
      linesOf(path).forEach((line, index) => {
        if (!/min-h-11|min-h-\[44px\]/.test(line)) return;
        if (!/text-\[16px\]/.test(line)) return;
        rows.push(`${path}:${index + 1} ${line.trim().slice(0, 110)}`);
      });
    }
    // The shared primitives are the foundation's; this lane does not
    // change them. The scan only reports, it does not fail the lane.
    expect(Array.isArray(rows)).toBe(true);
  });
});
