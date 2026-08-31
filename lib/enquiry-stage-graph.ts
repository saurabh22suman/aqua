import type { EnquiryStage } from "@/db/schema/enquiries";

// C-13's allowed pipeline graph, shared between the server-side
// enforcer (lib/services/enquiries.ts) and any client-side stage
// controls -- same shape as lib/member-status-graph.ts. "lost" is not
// quite terminal: it can reopen to "new" (someone comes back), but a
// converted enquiry never moves again -- a real member exists by then
// and further changes go through transitionMemberStatus instead.
// "new" can go straight to trial_scheduled or converted, not just
// contacted -- a walk-in who does a trial swim on the spot, or a
// sibling of an existing member who converts immediately, never
// passes through a separate "contacted" step in reality.
export const ENQUIRY_STAGE_TRANSITIONS: Record<EnquiryStage, EnquiryStage[]> = {
  new: ["contacted", "trial_scheduled", "converted", "lost"],
  contacted: ["trial_scheduled", "converted", "lost"],
  trial_scheduled: ["trial_completed", "lost"],
  trial_completed: ["converted", "lost"],
  converted: [],
  lost: ["new"],
};

export const ENQUIRY_STAGE_LABELS: Record<EnquiryStage, string> = {
  new: "New",
  contacted: "Contacted",
  trial_scheduled: "Trial scheduled",
  trial_completed: "Trial completed",
  converted: "Converted",
  lost: "Lost",
};
