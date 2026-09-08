import { notFound } from "next/navigation";
import { ShieldCheck, Users } from "lucide-react";
import {
  getMemberDetailAction,
  getMemberIdCardContextAction,
} from "@/lib/actions/people";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { MemberEnrolmentPanel } from "@/components/member-enrolment-panel";
import { MemberIdCard } from "@/components/member-id-card";

// B3 — reception previously had no member detail page at all: a
// receptionist who created a member (or one produced by converting an
// enquiry) had no way to see them again, let alone enrol them in a
// batch. Reuses getMemberDetailAction (assertStaff already includes
// receptionist) rather than duplicating the query; scoped to what
// reception needs right after registration — identity, guardians,
// consent, enrolment — not lifecycle controls or attendance history,
// which live on the owner-side detail page.

export default async function ReceptionMemberDetailPage({
  params,
}: {
  params: Promise<{ memberId: string }>;
}) {
  const { memberId } = await params;
  const [member, cardCtx, terminology] = await Promise.all([
    getMemberDetailAction(memberId),
    getMemberIdCardContextAction(),
    // The id-card's eyebrow renders the closed-key `member`
    // singular form via resolveTerm (L3 audit). Reception
    // registers the member and prints the card in the same visit;
    // the same terminology fetch that the owner-side page uses
    // pays the cost here too.
    getTerminologyAction(),
  ]);
  if (!member) notFound();

  return (
    <main className="px-5 pt-10 pb-8">
      {cardCtx && terminology ? (
        <div className="print-isolate-block">
          <MemberIdCard
            tenantSlug={cardCtx.tenantSlug}
            tenantDisplayName={cardCtx.displayName}
            tenantAccent={cardCtx.accent}
            initials={cardCtx.initials}
            memberFullName={member.fullName}
            memberCode={member.memberCode}
            memberUuid={member.memberId}
            terminology={terminology}
          />
        </div>
      ) : null}

      <h1 className="font-display text-[19px] font-semibold mt-6">{member.fullName}</h1>
      <p className="mt-0.5 text-[12.5px] text-ink-3">
        {member.memberCode} · {member.locationName}
        {member.isMinor ? " · minor" : ""}
      </p>

      <MemberEnrolmentPanel memberId={member.memberId} />

      {member.isMinor ? (
        <section className="mt-4">
          <h2 className="flex items-center gap-1.5 font-display text-[14px] font-semibold">
            <Users size={15} className="text-ink-3" />
            Guardians
          </h2>
          {member.guardians.length === 0 ? (
            <p className="mt-2 text-[13px] text-ink-3">No guardian on file.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line rounded-card border border-line bg-paper">
              {member.guardians.map((g) => (
                <li key={g.personId} className="px-3.5 py-2.5 text-[13px]">
                  <span className="font-medium">{g.fullName}</span>
                  <span className="text-ink-3"> — {g.relationship}</span>
                  {g.phone ? <span className="text-ink-3"> · {g.phone}</span> : null}
                  {g.isPrimary ? <span className="ml-1.5 text-[11px] text-water">primary</span> : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className="mt-4">
        <h2 className="flex items-center gap-1.5 font-display text-[14px] font-semibold">
          <ShieldCheck size={15} className="text-ink-3" />
          Consent
        </h2>
        {member.consents.length === 0 ? (
          <p className="mt-2 text-[13px] text-ink-3">No consent on file.</p>
        ) : (
          <ul className="mt-2 divide-y divide-line rounded-card border border-line bg-paper">
            {member.consents.map((c, i) => (
              <li key={i} className="px-3.5 py-2.5 text-[13px]">
                <span className="capitalize font-medium">{c.purpose}</span>
                <span className="text-ink-3">
                  {" "}
                  — {c.withdrawnAt ? `withdrawn ${new Date(c.withdrawnAt).toLocaleDateString("en-IN")}` : "active"},
                  granted by {c.granterName || "self"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
