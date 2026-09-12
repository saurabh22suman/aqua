import Link from "next/link";
import { Plus } from "lucide-react";
import { listMembersAction } from "@/lib/actions/people";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { MembersBoard } from "@/components/members-board";
import { requireOwner } from "@/lib/auth/surface-guard";
import { resolveTerm, titleCase } from "@/lib/terminology/keys";
import { isUuid } from "@/lib/params";

export default async function MembersPage({
  searchParams,
}: {
  searchParams?: Promise<{ facility?: string }>;
}) {
  await requireOwner();
  const params = searchParams ? await searchParams : {};
  // W1-6 — the owner layout's facility switcher persists the choice in
  // `?facility=`. "all" (or a malformed value) means the consolidated
  // list; a real location id scopes the list to that facility.
  const initialLocationId =
    params.facility && isUuid(params.facility) ? params.facility : undefined;
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
        <Link
          href="/owner/members/new"
          className="flex items-center gap-1.5 rounded-ctl bg-[var(--accent)] px-3.5 py-2 text-[13px] font-medium text-white"
        >
          <Plus size={16} strokeWidth={2.4} />
          Add
        </Link>
      </div>
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
