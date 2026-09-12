import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarCheck, Pencil, ShieldCheck, Users } from "lucide-react";
import {
  getMemberDetailAction,
  getMemberIdCardContextAction,
} from "@/lib/actions/people";
import { getMemberAttendanceHistoryAction } from "@/lib/actions/attendance";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { MemberStatusPanel } from "@/components/member-status-panel";
import { MemberEnrolmentPanel } from "@/components/member-enrolment-panel";
import { ParentLinkPanel } from "@/components/parent-link-panel";
import { MemberIdCard } from "@/components/member-id-card";
import { MEMBER_STATUS_LABELS } from "@/lib/member-status-graph";
import { resolveTerm } from "@/lib/terminology/keys";
import { formatPhoneIN } from "@/lib/phone";
import { formatDateIST } from "@/lib/time/tz";
import { InlineEditField } from "@/components/member-detail/inline-edit-field";
import { requireOwner } from "@/lib/auth/surface-guard";
import { BackLink } from "@/components/ui/BackLink";

export default async function MemberDetailPage({
  params,
}: {
  params: Promise<{ memberId: string }>;
}) {
  await requireOwner();
  const { memberId } = await params;
  const [member, attendanceHistory, cardCtx, terminology] = await Promise.all([
    getMemberDetailAction(memberId),
    getMemberAttendanceHistoryAction(memberId),
    getMemberIdCardContextAction(),
    // The id-card's eyebrow renders the closed-key `member`
    // singular form via resolveTerm (L3 audit). The page already
    // fetched the other three; adding terminology here keeps the
    // card self-consistent without a second round trip on its
    // own — and only the page that mounts the card pays the cost.
    getTerminologyAction(),
  ]);
  if (!member) notFound();

  return (
    <main className="px-5 pt-6 pb-8">
      <BackLink href="/owner/members" label="Members" />
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

      <div className="mt-6 flex items-start justify-between">
        <div>
          <h1 className="font-display text-[19px] font-semibold">
            <InlineEditField
              value={member.fullName}
              field="fullName"
              memberId={member.memberId}
              type="text"
              snapshot={member}
              valueClassName="font-display text-[19px] font-semibold text-ink"
            />
          </h1>
          <p className="mt-0.5 text-[12.5px] text-ink-3">
            {member.memberCode} · {member.locationName}
            {member.isMinor ? " · minor" : ""}
          </p>
        </div>
        <Link
          href={`/owner/members/${member.memberId}/edit`}
          className="flex items-center gap-1.5 rounded-ctl border border-line px-3 py-2 text-[13px]"
        >
          <Pencil size={14} />
          Edit
        </Link>
      </div>

      <div className="mt-4 rounded-card border border-line bg-paper p-3.5">
        <p className="text-[12px] text-ink-3">Status</p>
        <p className="mt-0.5 font-display text-[16px] font-semibold">
          {MEMBER_STATUS_LABELS[member.status]}
        </p>
        <MemberStatusPanel memberId={member.memberId} status={member.status} />
      </div>

      <MemberEnrolmentPanel memberId={member.memberId} terminology={terminology} />

      <ParentLinkPanel
        memberId={member.memberId}
        memberName={member.fullName}
        primaryGuardianName={
          Array.isArray(member.guardians) && member.guardians.length > 0
            ? member.guardians[0]!.fullName
            : null
        }
      />

      <dl className="mt-4 rounded-card border border-line bg-paper p-3.5 space-y-2 text-[13px]">
        <div className="flex justify-between">
          <dt className="text-ink-3">Phone</dt>
          <dd>
            <InlineEditField
              value={member.phone ?? ""}
              field="phone"
              memberId={member.memberId}
              type="text"
              snapshot={member}
              placeholder="Add phone"
              formatAs="phone"
            />
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink-3">Date of birth</dt>
          <dd>
            <InlineEditField
              value={member.dateOfBirth ?? ""}
              field="dateOfBirth"
              memberId={member.memberId}
              type="date"
              snapshot={member}
            />
          </dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink-3">Gender</dt>
          <dd>
            <InlineEditField
              value={member.gender ?? ""}
              field="gender"
              memberId={member.memberId}
              type="select"
              options={[
                { value: "male", label: "Male" },
                { value: "female", label: "Female" },
                { value: "other", label: "Other" },
              ]}
              snapshot={member}
              valueClassName="capitalize"
            />
          </dd>
        </div>
        <div>
          <dt className="text-ink-3">Medical notes</dt>
          <dd className="mt-0.5">
            <InlineEditField
              value={member.medicalNotes ?? ""}
              field="medicalNotes"
              memberId={member.memberId}
              type="textarea"
              snapshot={member}
              placeholder="Add medical notes"
            />
          </dd>
        </div>
      </dl>

      {member.isMinor ? (
        <section className="mt-4">
          <h2 className="flex items-center gap-1.5 font-display text-[14px] font-semibold">
            <Users size={15} className="text-ink-3" />
            Guardians
          </h2>
          {member.guardians.length === 0 ? (
            <p className="mt-2 text-[13px] text-ink-3">
              No {resolveTerm(terminology, "guardian", 1)} on file.
            </p>
          ) : (
            <ul className="mt-2 divide-y divide-line rounded-card border border-line bg-paper">
              {member.guardians.map((g) => (
                <li key={g.personId} className="px-3.5 py-2.5 text-[13px]">
                  <span className="font-medium">{g.fullName}</span>
                  <span className="text-ink-3"> — {g.relationship}</span>
                  {g.phone ? (
                    <span className="text-ink-3"> · {formatPhoneIN(g.phone)}</span>
                  ) : null}
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
                  — {c.withdrawnAt ? `withdrawn ${formatDateIST(c.withdrawnAt)}` : "active"},
                  granted by {c.granterName || "self"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {member.statusHistory.length > 0 ? (
        <section className="mt-4">
          <h2 className="font-display text-[14px] font-semibold">Status history</h2>
          <ul className="mt-2 divide-y divide-line rounded-card border border-line bg-paper">
            {member.statusHistory.map((h, i) => (
              <li key={i} className="px-3.5 py-2.5 text-[13px]">
                <span className="font-medium">
                  {MEMBER_STATUS_LABELS[h.fromStatus as keyof typeof MEMBER_STATUS_LABELS] ?? h.fromStatus} →{" "}
                  {MEMBER_STATUS_LABELS[h.toStatus as keyof typeof MEMBER_STATUS_LABELS] ?? h.toStatus}
                </span>
                <span className="text-ink-3"> — {h.reason ?? "no reason given"}</span>
                <p className="text-[11px] text-ink-3">{formatDateIST(h.changedAt)}</p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-4">
        <h2 className="flex items-center gap-1.5 font-display text-[14px] font-semibold">
          <CalendarCheck size={15} className="text-ink-3" />
          Attendance this month
        </h2>
        <div className="mt-2 rounded-card border border-line bg-paper p-3.5">
          <p className="font-display text-[24px] font-semibold">
            {attendanceHistory.pct === null ? "—" : `${attendanceHistory.pct}%`}
          </p>
          <p className="text-[12px] text-ink-3">
            {attendanceHistory.totalCount === 0
              ? "No sessions marked yet this month."
              : `${attendanceHistory.presentCount} of ${attendanceHistory.totalCount} sessions present`}
          </p>
        </div>
        {attendanceHistory.rows.length > 0 ? (
          <ul className="mt-2 divide-y divide-line rounded-card border border-line bg-paper">
            {attendanceHistory.rows.map((r) => (
              <li key={r.sessionId} className="flex items-center justify-between px-3.5 py-2.5 text-[13px]">
                <span>
                  {r.sessionDate} · {r.batchName}
                </span>
                <span
                  className={`rounded-pill px-2 py-0.5 text-[11px] font-medium ${
                    r.status === "present"
                      ? "bg-good-soft text-good"
                      : r.status === "late"
                        ? "bg-warn-soft text-warn"
                        : "bg-late-soft text-late"
                  }`}
                >
                  {r.status}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </main>
  );
}
