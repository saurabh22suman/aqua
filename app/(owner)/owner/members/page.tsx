import Link from "next/link";
import { Plus } from "lucide-react";
import { listLocationsAction, listMembersAction } from "@/lib/actions/people";
import { MembersBoard } from "@/components/members-board";

export default async function MembersPage() {
  const [members, locations] = await Promise.all([
    listMembersAction({}),
    listLocationsAction(),
  ]);

  return (
    <main className="px-5 pt-10 pb-8">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-[19px] font-semibold">Members</h1>
        <Link
          href="/owner/members/new"
          className="flex items-center gap-1.5 rounded-ctl bg-[var(--accent)] px-3.5 py-2 text-[13px] font-medium text-white"
        >
          <Plus size={16} strokeWidth={2.4} />
          Add
        </Link>
      </div>
      <div className="mt-4">
        <MembersBoard initialMembers={members} locations={locations} />
      </div>
    </main>
  );
}
