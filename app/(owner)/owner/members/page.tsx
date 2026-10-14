import Link from "next/link";
import { cookies } from "next/headers";
import { Plus, Upload } from "lucide-react";
import { listMembersAction } from "@/lib/actions/people";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { MembersBoard } from "@/components/members-board";
import { requireOwner, requirePagePermission } from "@/lib/auth/surface-guard";
import { hasPermission } from "@/lib/auth/permission";
import { resolveTerm, titleCase } from "@/lib/terminology/keys";
import { FACILITY_COOKIE, resolveFacilityValue } from "@/lib/facility";

export default async function MembersPage({
  searchParams,
}: {
  searchParams?: Promise<{ facility?: string }>;
}) {
  const ctx = await requireOwner();
  requirePagePermission(ctx, "members.read");
  const canWriteMembers = hasPermission(ctx, "members.write");
  const params = searchParams ? await searchParams : {};
  // W1-6 — the owner layout's facility switcher persists the choice in
  // `?facility=` and a cookie. The URL wins; the cookie carries the
  // choice to pages opened from the sidebar. "all" (or a malformed
  // value) means the consolidated list.
  const cookieStore = await cookies();
  const initialLocationId = resolveFacilityValue(
    params.facility,
    cookieStore.get(FACILITY_COOKIE)?.value,
  );
  const [members, terminology] = await Promise.all([
    listMembersAction({ locationId: initialLocationId }),
    getTerminologyAction(),
  ]);

  return (
    <main className="px-5 pt-10 pb-8">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-[19px] font-semibold">
          {titleCase(resolveTerm(terminology, "member", "other"))}
        </h1>
        <div className="flex items-center gap-2">
          {canWriteMembers ? (
            <>
              <Link
                href="/owner/members/import"
                className="flex min-h-11 items-center gap-1.5 rounded-ctl border border-line px-3.5 py-2 text-[13px] font-medium text-ink-2 hover:text-ink"
                data-testid="members-import-link"
              >
                <Upload size={15} strokeWidth={2.2} />
                Import
              </Link>
              <Link
                href="/owner/members/new"
                className="flex min-h-11 items-center gap-1.5 rounded-ctl bg-[var(--accent-strong)] px-3.5 py-2 text-[13px] font-medium text-white"
              >
                <Plus size={16} strokeWidth={2.4} />
                Add
              </Link>
            </>
          ) : null}
        </div>
      </div>
      {members.length === 0 ? (
        canWriteMembers ? (
          <p className="mt-3 text-[12.5px] text-ink-3">
            No {resolveTerm(terminology, "member", "other")} yet — add the first
            one, or{" "}
            <Link
              href="/owner/members/import"
              className="text-[var(--accent-ink)] underline underline-offset-2"
            >
              import your existing register
            </Link>
            .
          </p>
        ) : (
          <p className="mt-3 text-[12.5px] text-ink-3">
            No {resolveTerm(terminology, "member", "other")} yet.
          </p>
        )
      ) : null}
      <div className="mt-4">
        <MembersBoard
          initialMembers={members}
          terminology={terminology}
          initialLocationId={initialLocationId}
        />
      </div>
    </main>
  );
}
