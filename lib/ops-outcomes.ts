export const OPS_OUTCOMES = ["success", "invalid", "denied", "error", "noop"] as const;

export type OpsBoundaryOutcome = (typeof OPS_OUTCOMES)[number];
