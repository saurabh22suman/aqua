// THE WORDS THIS SURFACE USES.
//
// The vocabulary lives in one place so the page, the panel and anything
// that reads them later cannot drift apart: the link's status, the
// club's standing on a pairing, which account is being confirmed, and
// what a refusal tells the staff member to do next.
//
// NOTHING HERE IS A RULE. The codes these sentences answer are the
// APPROVED SERVICE'S OWN codes (lib/services/member-link-binding.ts), and
// an unknown code falls back to the service's own message rather than to
// an invention here.
//
// THE TWO NUMBERS ARE TWO DIFFERENT THINGS. The account's sign-in
// number belongs to the ACCOUNT; the club's record number belongs to the
// PERSON. They may differ — the same person may sign in with a number
// the club has never seen — and nothing here compares them. A pairing is
// an identity claim made by a person who can see both, never a proof
// that anybody holds a phone.

import { formatDateTimeIST } from "@/lib/time/tz";
import { formatPhoneIN } from "@/lib/phone";
import type { StatusTone } from "@/components/ui/StatusBadge";
import type {
  MemberAccessLink,
  MemberAccessStatus,
} from "@/lib/services/member-link-readmodel";

export const LINK_STATUS_LABEL: Record<MemberAccessStatus, string> = {
  invited: "Invited",
  active: "Active",
  revoked: "Revoked",
};

export const LINK_STATUS_TONE: Record<MemberAccessStatus, StatusTone> = {
  // The person has accepted the invitation. This says nothing about
  // whether the club stands behind the pairing.
  active: "good",
  // Waiting for the person to accept it.
  invited: "warn",
  // A terminal state, so it is quiet.
  revoked: "neutral",
};

/** Every sentence the card speaks, in one object. */
export const ACCESS_COPY = {
  accountPhoneLabel: "Account sign-in number",
  clubPhoneLabel: "Club record number",
  identityNote:
    "These two numbers can differ. Confirming says which account belongs to this person — it is not a claim about who holds the phone.",
  unknownAccount:
    "The linked account could not be read, so this pairing cannot be confirmed here. Ask the club to review the link.",
  lostResponse:
    "The result could not be confirmed. It may still have gone through — refresh the page before trying again.",
  readFailure: "This was only a read, so nothing was changed. Try again.",
  clipboardUnavailable:
    "Copy did not work on this device. The invitation is shown below — copy it by hand.",
} as const;

/** The invitation page for each audience. The code rides in the fragment. */
export function activationPath(audience: MemberAccessLink["audience"]): string {
  return audience === "guardian" ? "/family/activate" : "/member/activate";
}

/** The club's record of the person today. */
export function clubPhoneText(phone: string | null): string {
  return phone ? formatPhoneIN(phone) : "Not recorded";
}

/** The account's own current sign-in number. */
export function accountPhoneText(phone: string | null): string {
  return phone ? formatPhoneIN(phone) : "Could not be read";
}

/**
 * THE STAFF MEMBER'S OWN ATTESTATION, per link.
 *
 * It says what the staff member checked. It is not a claim about a
 * phone, and it is not a phone-equality gate: the two numbers are
 * allowed to differ.
 */
export function acknowledgementLabel(link: MemberAccessLink): string {
  return `I checked that this account is ${link.personName}.`;
}

/** The refusal says what to do next, not what failed. */
export function refusalMessage(code: string, message: string): string {
  if (code === "not_found") {
    return "That link is no longer available. Reload the page to see the current links.";
  }
  if (code === "not_confirmable") {
    return "The club's record for this person has changed since this link was made, so this pairing cannot be confirmed now. The club should review the link and the record together — the number does not have to be changed back.";
  }
  if (code === "nothing_to_withdraw") {
    return "There is no confirmation on this link to withdraw.";
  }
  return message;
}

/** Who the attestation was made by, in words. */
function basisWord(basis: string | null): string {
  return basis === "owner_attestation" ? "the club owner" : "a facility manager";
}

/**
 * THE CLUB'S STANDING, in one sentence.
 *
 * A confirmation that no longer stands is said so plainly: it is not
 * dressed up as an active confirmation.
 */
export function confirmationText(link: MemberAccessLink): string {
  if (link.confirmed && link.confirmedAt) {
    return `Confirmed by ${basisWord(link.confirmedBasis)} on ${formatDateTimeIST(link.confirmedAt)}`;
  }
  if (link.confirmationLapsed && link.confirmedAt) {
    return `A confirmation was recorded on ${formatDateTimeIST(link.confirmedAt)}, but ${basisWord(link.confirmedBasis)} no longer holds the authority to confirm here. The club should review this link.`;
  }
  return "The club has not confirmed this pairing.";
}

/** A date that crossed the server boundary as a string stays a string. */
export function toIso(value: Date | string): string {
  if (typeof value === "string") return value;
  return value.toISOString();
}
