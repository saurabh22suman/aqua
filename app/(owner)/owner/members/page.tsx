import Link from "next/link";
import { cookies } from "next/headers";
import { Plus, Upload } from "lucide-react";
import { listMembersAction } from "@/lib/actions/people";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { MembersBoard } from "@/components/members-board";
import { buttonClasses } from "@/components/ui/Button";
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
      {/* Owner redesign (C2) — one dominant action per workflow: "Add"
          is the primary control beside the title and "Import" is the
          secondary one. Both are the shared button classes, so their
          height, radius and tints stay with the foundation owner. */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-[19px] font-semibold">
            {titleCase(resolveTerm(terminology, "member", "other"))}
          </h1>
          <p className="mt-1 text-[12.5px] text-ink-3">
            Find a person and continue their work.
          </p>
        </div>
        {canWriteMembers ? (
          <div className="flex flex-none items-center gap-2">
            <Link
              href="/owner/members/import"
              className={buttonClasses({ variant: "secondary", size: "md" })}
              data-testid="members-import-link"
            >
              <Upload size={15} strokeWidth={2.2} aria-hidden="true" />
              Import
            </Link>
            <Link
              href="/owner/members/new"
              className={buttonClasses({ variant: "primary", size: "md" })}
            >
              <Plus size={16} strokeWidth={2.4} aria-hidden="true" />
              Add
            </Link>
          </div>
        ) : null}
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
