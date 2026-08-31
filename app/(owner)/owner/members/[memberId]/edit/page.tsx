import { notFound } from "next/navigation";
import { getMemberDetailAction, listLocationsAction } from "@/lib/actions/people";
import { MemberEditForm } from "@/components/member-edit-form";

export default async function EditMemberPage({
  params,
}: {
  params: Promise<{ memberId: string }>;
}) {
  const { memberId } = await params;
  const [member, locations] = await Promise.all([
    getMemberDetailAction(memberId),
    listLocationsAction(),
  ]);
  if (!member) notFound();

  return (
    <main className="px-5 pt-10 pb-8">
      <h1 className="font-display text-[19px] font-semibold">Edit {member.fullName}</h1>
      <div className="mt-4">
        <MemberEditForm member={member} locations={locations} />
      </div>
    </main>
  );
}
