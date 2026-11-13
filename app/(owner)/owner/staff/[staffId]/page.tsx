import { isLiveOwnerForSettings } from "@/lib/auth/owner-settings-page-guard";
import { notFound } from "next/navigation";
import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { listStaffAction } from "@/lib/actions/staff";
import { titleCase } from "@/lib/terminology/keys";
import { formatDateIST } from "@/lib/time/tz";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { hasPermission } from "@/lib/auth/permission";
import { getCurriculumLeadState } from "@/lib/services/curriculum-lead";
import { CurriculumLeadControl } from "@/components/curriculum-lead-control";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import { OwnerPage } from "@/components/owner-ui/owner-page";
import { PersonAvatar } from "@/components/avatar";

// Owner OpenPen management lane (29 October 2026).
//
// A small read-only profile. The one delegated change it carries is the
// curriculum-lead designation (R02): the owner can mark a coach as the
// academy's curriculum lead or remove that delegation. Login access is
// stated in the same words as the staff directory and managed in
// Invitations — a linked identity is not an active login.
export default async function StaffDetailPage({
  params,
}: {
  params: Promise<{ staffId: string }>;
}) {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "staff.read");
  const { staffId } = await params;
  const rows = await listStaffAction({});
  const staff = rows.find((r) => r.id === staffId);
  if (!staff) notFound();

  const isLiveOwner = await isLiveOwnerForSettings(ctx);
  const canDelegate = isLiveOwner && hasPermission(ctx, "settings.manage");
  const canInviteStaff = isLiveOwner && hasPermission(ctx, "staff.invite");
  const curriculumState =
    canDelegate && staff.staffType === "coach"
      ? await getCurriculumLeadState(ctx, staffId)
      : null;

  return (
    <OwnerPage>
      <Link
        href="/owner/staff"
        className="mb-4 inline-flex min-h-11 items-center gap-1 text-[13px] text-ink-3 hover:text-ink"
      >
        <OwnerIcon name="left" size={16} />
        Staff
      </Link>

      <div className="flex items-center gap-4">
        {/* The shared initials avatar: the flat themed tint and the same
            grapheme-safe initials as the staff directory, the member chips and
            the profile. Decorative beside the visible name — the heading is the
            text, and the avatar repeats no identity of its own. The 56px
            rounded-square profile shape is kept by the clipping wrapper. */}
        <span className="flex-none overflow-hidden rounded-card">
          <PersonAvatar
            name={staff.fullName}
            seed={staff.personId}
            size={56}
            square
          />
        </span>
        <div className="min-w-0">
          <h1 className="truncate font-display text-[22px] font-semibold leading-tight tracking-[-0.4px]">
            {staff.fullName}
          </h1>
          <p className="mt-0.5 text-[13px] text-ink-3">
            {titleCase(staff.staffType)}
            {staff.employedOn
              ? ` · employed ${formatDateIST(staff.employedOn)}`
              : ""}
          </p>
        </div>
      </div>

      <section className="mt-5 rounded-card border border-line bg-paper p-5">
        <h2 className="font-display text-[16px] font-semibold text-ink">
          Staff details
        </h2>
        <dl className="mt-1">
          <div className="border-b border-line py-3">
            <dt className="text-[12px] text-ink-3">Staff type</dt>
            <dd className="mt-0.5 text-[14px] text-ink">
              {titleCase(staff.staffType)}
            </dd>
          </div>
          <div className="border-b border-line py-3">
            <dt className="text-[12px] text-ink-3">Login access</dt>
            <dd className="mt-0.5 text-[14px] text-ink">
              {staff.userId ? "Linked" : "Not linked"}
            </dd>
            <dd className="mt-1 text-[12.5px] text-ink-3">
              {staff.userId
                ? `A phone-based login is linked to this record — they sign in with their phone number and PIN, no separate password.${canInviteStaff ? " Invitations holds the current access state." : ""}`
                : `No login is linked to this record.${canInviteStaff ? " Send an invite from Invitations to add one." : ""}`}
            </dd>
          </div>
        </dl>
        {canInviteStaff ? (
          <Link
            href="/owner/staff/invitations"
            className="mt-3 inline-flex min-h-11 items-center text-[13px] font-medium text-[var(--accent-ink)] underline underline-offset-2 hover:text-ink"
          >
            Manage access in Invitations
          </Link>
        ) : null}
      </section>

      {curriculumState ? (
        <CurriculumLeadControl
          staffId={staff.id}
          fullName={staff.fullName}
          state={curriculumState}
        />
      ) : null}

      <p className="mt-5 text-[12.5px] leading-snug text-ink-3">
        Staff record details are read-only here.{" "}
        <Link
          href="/owner/staff"
          className="font-medium text-[var(--accent-ink)] underline underline-offset-2"
        >
          Back to staff
        </Link>
      </p>
    </OwnerPage>
  );
}
