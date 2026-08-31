import type { MemberStatus } from "@/db/schema/people";

// C-08's allowed graph, shared between the server-side enforcer
// (lib/services/member-status.ts) and the client-side status controls
// (components/member-status-panel.tsx) so the UI only ever offers a
// transition the server will actually accept. No side effects here --
// safe to import from a "use client" component.
export const MEMBER_STATUS_TRANSITIONS: Record<MemberStatus, MemberStatus[]> = {
  trial: ["active", "lapsed", "left"],
  active: ["paused", "lapsed", "left"],
  paused: ["active", "left"],
  lapsed: ["active", "left"],
  left: ["active"],
};

export const MEMBER_STATUS_LABELS: Record<MemberStatus, string> = {
  trial: "Trial",
  active: "Active",
  paused: "Paused",
  lapsed: "Lapsed",
  left: "Left",
};
