import { isMinor } from "@/lib/time/tz";

export type ShowcaseConsentState = "unknown" | "approved" | "revoked";

export type ShowcaseEligibilityInput = {
  isMinor: boolean;
  subjectPersonId: string;
  consentState: ShowcaseConsentState;
  decider: null | {
    personId: string;
    isRegisteredGuardian: boolean;
  };
};

export type ShowcaseEligibilityResult = { eligible: boolean; reason: string };

export type ShowcaseStandingInput = {
  subjectDateOfBirth: string | null;
  subjectTimeZone: string;
  now?: number;
  subjectPersonId: string;
  consentState: ShowcaseConsentState;
  consentGrantedByPersonId: string | null;
  decider: null | {
    personId: string;
    authority: "self" | "linked_guardian";
  };
  isRegisteredGuardian?: boolean;
};

export type ShowcaseStandingResult = { publishable: boolean; reason: string };

export function resolveShowcaseEligibility(
  input: ShowcaseEligibilityInput,
): ShowcaseEligibilityResult {
  if (input.consentState === "unknown") {
    return {
      eligible: false,
      reason: "no decision on file — nobody has been asked yet",
    };
  }
  if (input.consentState === "revoked") {
    return {
      eligible: false,
      reason: "the decision was withdrawn — it cannot publish anything",
    };
  }
  if (!input.decider) {
    return {
      eligible: false,
      reason: "no decision on file — nobody has decided",
    };
  }

  const isSubject = input.decider.personId === input.subjectPersonId;

  if (!input.isMinor) {
    if (isSubject) {
      return {
        eligible: true,
        reason: "the adult member approved this themselves",
      };
    }
    return {
      eligible: false,
      reason:
        "an adult member's own decision is required — nobody else can publish their achievements",
    };
  }

  if (isSubject) {
    return {
      eligible: false,
      reason:
        "a minor cannot approve their own publication — the linked guardian is the consent holder",
    };
  }
  if (input.decider.isRegisteredGuardian) {
    return {
      eligible: true,
      reason: "a linked guardian approved this for the minor",
    };
  }
  return {
    eligible: false,
    reason: "the decision was not made by a live linked guardian",
  };
}

export function resolveShowcaseStanding(
  input: ShowcaseStandingInput,
): ShowcaseStandingResult {
  if (input.subjectDateOfBirth === null) {
    return {
      publishable: false,
      reason:
        "no date of birth on file — refusing to guess whether this member is an adult",
    };
  }
  if (input.consentState === "unknown") {
    return {
      publishable: false,
      reason: "no decision on file — nobody has decided",
    };
  }
  if (input.consentState === "revoked") {
    return {
      publishable: false,
      reason: "the decision was withdrawn",
    };
  }
  if (!input.decider) {
    return {
      publishable: false,
      reason: "there is no decider on this publication",
    };
  }

  const subjectIsMinor = isMinor(
    input.subjectDateOfBirth,
    input.subjectTimeZone,
    input.now,
  );
  const grantedBySubject =
    input.consentGrantedByPersonId !== null &&
    input.consentGrantedByPersonId === input.subjectPersonId;
  const deciderIsSubject = input.decider.personId === input.subjectPersonId;

  if (!subjectIsMinor) {
    if (grantedBySubject && deciderIsSubject) {
      return {
        publishable: true,
        reason: "the adult's own opt-in stands",
      };
    }
    if (!grantedBySubject) {
      return {
        publishable: false,
        reason:
          "the member is an adult now — a guardian's approval no longer stands and the member has not opted in themselves",
      };
    }
    return {
      publishable: false,
      reason:
        "the publication was approved by the member, but this decider is not the member",
    };
  }

  if (deciderIsSubject) {
    return {
      publishable: false,
      reason:
        "a minor cannot approve their own publication — the linked guardian is the consent holder",
    };
  }
  if (
    input.decider.authority === "linked_guardian" &&
    input.consentGrantedByPersonId === input.decider.personId &&
    input.isRegisteredGuardian === true
  ) {
    return {
      publishable: true,
      reason: "a linked guardian approved this for the minor",
    };
  }
  return {
    publishable: false,
    reason:
      "the publication was not approved by a live linked guardian of this member",
  };
}
