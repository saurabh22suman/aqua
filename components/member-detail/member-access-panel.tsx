"use client";

import { useState } from "react";
import { GuardianAuthorizationControl } from "@/components/member-detail/guardian-authorization-control";
import { useRouter } from "next/navigation";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { SectionHeading } from "@/components/ui/PageHeader";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { formatDateTimeIST } from "@/lib/time/tz";
import {
  confirmLinkBindingAction,
  issueMemberActivationTokenAction,
  withdrawLinkBindingAction,
} from "@/lib/actions/member-link-binding";
import {
  ACCESS_COPY,
  accountPhoneText,
  acknowledgementLabel,
  activationPath,
  clubPhoneText,
  confirmationText,
  LINK_STATUS_LABEL,
  LINK_STATUS_TONE,
  refusalMessage,
  toIso,
} from "@/components/member-detail/member-access-copy";
import type {
  MemberAccessLink,
  MemberAccessRead,
} from "@/lib/services/member-link-readmodel";

// THE STAFF SIDE OF A MEMBER'S SIGN-IN LINK.
//
// Link confirmations and guardian authorizations are distinct operations.
// Each write checks the actor's live authority in its own service.
//
// WHICH ACCOUNT IS BEING CONFIRMED? The card shows BOTH numbers: the
// account's own current sign-in number and the club's record of the
// person. They may differ and are never compared — the pairing is an
// identity claim by a person who can see both, and the staff member ticks
// a box saying they checked. An unreadable account is a closed door.
//
// THE INVITATION IS HANDED OVER BY HAND. The URL is built in the browser
// from the token the issue action returns and carries the code in the
// FRAGMENT. The token is NOT on the screen by default: the staff member
// copies it and shows it only when the clipboard is unavailable.

type AccessAction = "confirm" | "withdraw" | "issue";
type AccessControl = { key: string; label: string; testId: string; action: AccessAction };
type Issued = { linkId: string; url: string; expiresAt: string };

export function MemberAccessPanel({
  read,
  failed,
}: {
  read: MemberAccessRead | null;
  failed: boolean;
}) {
  const router = useRouter();
  const [busyLinkId, setBusyLinkId] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ linkId: string; message: string } | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(false);
  const [acknowledged, setAcknowledged] = useState<Record<string, boolean>>({});

  function refuse(link: MemberAccessLink, result: { code: string; message: string }): void {
    setRefusal({ linkId: link.linkId, message: refusalMessage(result.code, result.message) });
  }

  async function run(link: MemberAccessLink, action: AccessAction): Promise<void> {
    setBusyLinkId(link.linkId);
    setRefusal(null);
    // The issued token never survives a change of standing.
    setCopied(false);
    setIssued(null);
    setShown(false);
    try {
      if (action === "issue") {
        const result = await issueMemberActivationTokenAction({
          audience: link.audience,
          linkId: link.linkId,
        });
        if (result.kind !== "ok") {
          refuse(link, result);
          return;
        }
        const origin = typeof window === "undefined" ? "" : window.location.origin;
        setIssued({
          linkId: link.linkId,
          url: `${origin}${activationPath(link.audience)}#token=${encodeURIComponent(result.token)}`,
          expiresAt: toIso(result.expiresAt),
        });
        return;
      }
      const result =
        action === "confirm"
          ? await confirmLinkBindingAction({ audience: link.audience, linkId: link.linkId })
          : await withdrawLinkBindingAction({ audience: link.audience, linkId: link.linkId });
      if (result.kind !== "ok") {
        refuse(link, result);
        return;
      }
      setAcknowledged((prev) => ({ ...prev, [link.linkId]: false }));
      // The club's standing changed. The page re-reads the links from the
      // database; the browser keeps nothing of its own.
      router.refresh();
    } catch {
      // THE ANSWER NEVER ARRIVED. The transaction may still have
      // committed, so the card does not promise that nothing changed.
      setRefusal({ linkId: link.linkId, message: ACCESS_COPY.lostResponse });
    } finally {
      setBusyLinkId(null);
    }
  }

  async function copyInvitation(): Promise<void> {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // No clipboard on this device: show the invitation so it can be
      // copied by hand, and say so.
      setCopied(false);
      setShown(true);
      setRefusal({ linkId: issued.linkId, message: ACCESS_COPY.clipboardUnavailable });
    }
  }

  if (failed || read === null) {
    return (
      <section className="rounded-card border border-line bg-paper p-4" data-testid="member-access-panel">
        <p className="text-[15px] font-medium text-ink">These links could not be read.</p>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-3">{ACCESS_COPY.readFailure}</p>
        <Button className="mt-3" onClick={() => router.refresh()}>Retry</Button>
      </section>
    );
  }

  return (
    <section className="rounded-card border border-line bg-paper p-4" data-testid="member-access-panel">
      <SectionHeading
        title="Sign-in links"
        subtitle={`${read.memberName} · ${read.memberCode} · ${read.facilityName}`}
      />
      {read.guardianChoices?.length ? (
        <section aria-label="Family authorizations" className="mt-4">
          <h3 className="text-sm font-medium text-ink">Family authorizations</h3>
          {read.guardianChoices.map((guardian) => <GuardianAuthorizationControl key={guardian.guardianshipId} {...guardian} />)}
        </section>
      ) : null}
      {read.links.length === 0 ? (
        <div className="mt-3">
          <p className="text-[15px] font-medium text-ink">No sign-in link yet</p>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-3">
            To set up sign-in, an authorised staff member first links or creates
            the account, then confirms the pairing and creates a private invitation.
            If the setup form is not available to you, ask an authorised staff member.
          </p>
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {read.links.map((link) => {
            const busy = busyLinkId === link.linkId;
            const invitation = issued?.linkId === link.linkId ? issued : null;
            const problem = refusal?.linkId === link.linkId ? refusal.message : null;
            const ack = acknowledged[link.linkId] === true;
            const audienceWord = link.audience === "guardian" ? "family" : "member";
            // A confirmation that no longer stands is still ON RECORD, so
            // it can still be withdrawn.
            const attested = link.confirmed || link.confirmationLapsed;
            const controls: AccessControl[] = [];
            if (link.status === "invited") {
              controls.push({ key: "issue", label: "Create invitation link", testId: "member-access-issue", action: "issue" });
            }
            // The confirmation is NOT here: it lives under the
            // acknowledgement below, so it can never be pressed by
            // accident.
            if (link.status !== "revoked" && attested) {
              controls.push({ key: "withdraw", label: "Withdraw the confirmation", testId: "member-access-withdraw", action: "withdraw" });
            }
            return (
              <li key={link.linkId} className="py-3" data-testid="member-access-link">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[14px] font-medium text-ink">
                      {link.audience === "member" ? "Member sign-in" : "Family sign-in"}
                      <span className="font-normal text-ink-3">
                        {" · "}{link.personName}
                        {link.relationship ? ` (${link.relationship})` : ""}
                      </span>
                    </p>
                    <p className="mt-0.5 text-[12.5px] leading-relaxed text-ink-3" data-testid="member-access-standing">
                      {confirmationText(link)}
                    </p>
                  </div>
                  <StatusBadge tone={LINK_STATUS_TONE[link.status]}>{LINK_STATUS_LABEL[link.status]}</StatusBadge>
                </div>

                <dl className="mt-2 grid grid-cols-1 gap-1 text-[13px] sm:grid-cols-2">
                  <div>
                    <dt className="text-[12px] text-ink-3">{ACCESS_COPY.accountPhoneLabel}</dt>
                    <dd className="text-ink" data-testid="member-access-account-phone">{accountPhoneText(link.accountPhone)}</dd>
                  </div>
                  <div>
                    <dt className="text-[12px] text-ink-3">{ACCESS_COPY.clubPhoneLabel}</dt>
                    <dd className="text-ink" data-testid="member-access-club-phone">{clubPhoneText(link.clubPhone)}</dd>
                  </div>
                </dl>
                <p className="mt-1 text-[12px] leading-relaxed text-ink-3">{ACCESS_COPY.identityNote}</p>

                {controls.length > 0 ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {controls.map((control) => (
                      <Button
                        key={control.key}
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => void run(link, control.action)}
                        data-testid={control.testId}
                      >
                        {busy ? "Working…" : control.label}
                      </Button>
                    ))}
                  </div>
                ) : null}

                {!attested && link.status !== "revoked" ? (
                  <div className="mt-2 rounded-ctl border border-line bg-deck p-3">
                    {link.accountPhone === null ? (
                      <p className="text-[12.5px] leading-relaxed text-ink-2" data-testid="member-access-unknown-account">
                        {ACCESS_COPY.unknownAccount}
                      </p>
                    ) : (
                      <>
                        <Checkbox
                          checked={ack}
                          onCheckedChange={(next) => setAcknowledged((prev) => ({ ...prev, [link.linkId]: next }))}
                          data-testid="member-access-ack"
                        >
                          {acknowledgementLabel(link)}
                        </Checkbox>
                        <Button
                          className="mt-2"
                          variant="secondary"
                          size="sm"
                          disabled={busy || !ack}
                          onClick={() => void run(link, "confirm")}
                          data-testid="member-access-confirm"
                        >
                          {busy ? "Working…" : "Confirm the pairing"}
                        </Button>
                      </>
                    )}
                  </div>
                ) : null}

                {problem ? (
                  <p className="mt-2 text-[12.5px] leading-relaxed text-ink-2" role="alert" data-testid="member-access-error">
                    {problem}
                  </p>
                ) : null}

                {invitation ? (
                  <div className="mt-2 rounded-ctl border border-line bg-deck p-3" data-testid="member-access-invitation">
                    <p className="text-[12.5px] font-medium text-ink">A private invitation is ready</p>
                    <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-3">
                      Valid until {formatDateTimeIST(invitation.expiresAt)}. It opens the {audienceWord}
                      sign-in once. Nothing was sent — hand it to {link.personName} yourself.
                    </p>
                    {shown ? (
                      <code className="mt-2 block break-all font-mono text-[12px] text-ink-2" data-testid="member-access-invitation-url">
                        {invitation.url}
                      </code>
                    ) : null}
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Button variant="secondary" size="sm" onClick={() => void copyInvitation()} data-testid="member-access-copy">
                        {copied ? <Check size={14} aria-hidden="true" /> : null}
                        {copied ? "Copied" : "Copy private invitation"}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setShown((value) => !value)} data-testid="member-access-show">
                        {shown ? "Hide invitation" : "Show invitation"}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
