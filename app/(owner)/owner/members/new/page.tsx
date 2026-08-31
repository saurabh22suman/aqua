import { listLocationsAction } from "@/lib/actions/people";
import { MemberCreateForm } from "@/components/member-create-form";

export default async function NewMemberPage() {
  const locations = await listLocationsAction();

  return (
    <main className="px-5 pt-10 pb-8">
      <h1 className="font-display text-[19px] font-semibold">Add member</h1>
      <div className="mt-4">
        <MemberCreateForm locations={locations} />
      </div>
    </main>
  );
}
