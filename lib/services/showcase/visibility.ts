import type { ShowcaseDecisionKind } from "@/db/schema/showcase";

export type { ShowcaseDecisionKind };

export type ShowcaseDeciderStanding = {
  deciderPersonId: string;
  decision: ShowcaseDecisionKind;
  identityCurrent: boolean;
};

export type ShowcaseVisibilityInput = {
  isMinor: boolean | null;
  subjectDecision: ShowcaseDecisionKind | null;
  subjectIdentityCurrent: boolean;
  guardianStandings: ShowcaseDeciderStanding[];
  hasChosenName: boolean;
};

export type ShowcaseVisibility = {
  publishable: boolean;
  state: "public" | "private" | "pending";
  reason: string;
};

export function allowedShowcaseActions(input: {
  role: "subject" | "guardian";
  isMinor: boolean | null;
}): ShowcaseDecisionKind[] {
  if (input.role === "subject") {
    if (input.isMinor === true) return ["no", "permit"];
    if (input.isMinor === false) return ["approve", "revoke"];
    return ["no", "revoke"];
  }
  if (input.isMinor === true) return ["approve", "revoke"];
  return [];
}

export function resolveShowcaseVisibility(
  input: ShowcaseVisibilityInput,
): ShowcaseVisibility {
  if (input.isMinor === null) {
    return {
      publishable: false,
      state: "private",
      reason: "No date of birth on file — nothing is published.",
    };
  }

  if (!input.isMinor) {
    if (input.subjectDecision === null) {
      return {
        publishable: false,
        state: "pending",
        reason: "No decision yet — nothing is published.",
      };
    }
    if (input.subjectDecision === "approve") {
      if (!input.subjectIdentityCurrent) {
        return {
          publishable: false,
          state: "private",
          reason: "Not published — the member's own approval is no longer standing.",
        };
      }
      if (!input.hasChosenName) {
        return {
          publishable: false,
          state: "private",
          reason: "No chosen name yet — nothing is published.",
        };
      }
      return { publishable: true, state: "public", reason: "This page is public." };
    }
    return {
      publishable: false,
      state: "private",
      reason: "Not published — the member's own decision is in force.",
    };
  }

  if (input.subjectDecision === "no") {
    return {
      publishable: false,
      state: "private",
      reason: "Not published — the member's own choice is in force.",
    };
  }
  if (input.subjectDecision !== null && input.subjectDecision !== "permit") {
    return {
      publishable: false,
      state: "private",
      reason: "Not published — the member's own decision is in force.",
    };
  }
  if (input.subjectDecision === "permit" && !input.subjectIdentityCurrent) {
    return {
      publishable: false,
      state: "private",
      reason: "Not published — the member's own choice is in force.",
    };
  }

  const withdrawals = input.guardianStandings.filter(
    (standing) => standing.decision === "revoke",
  );
  if (withdrawals.length > 0) {
    return {
      publishable: false,
      state: "private",
      reason: "Not published — a linked guardian's decision is in force.",
    };
  }

  const liveApprovals = input.guardianStandings.filter(
    (standing) => standing.decision === "approve" && standing.identityCurrent,
  );
  if (liveApprovals.length === 0) {
    const staleApproval = input.guardianStandings.some(
      (standing) => standing.decision === "approve",
    );
    if (staleApproval) {
      return {
        publishable: false,
        state: "private",
        reason: "Not published — the guardian's approval is no longer standing.",
      };
    }
    return {
      publishable: false,
      state: "pending",
      reason: "Not published yet — waiting for a guardian's approval.",
    };
  }

  if (!input.hasChosenName) {
    return {
      publishable: false,
      state: "private",
      reason: "No chosen name yet — nothing is published.",
    };
  }
  return { publishable: true, state: "public", reason: "This page is public." };
}
