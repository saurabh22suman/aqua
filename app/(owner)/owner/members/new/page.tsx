import { listLocationsAction } from "@/lib/actions/people";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { resolveTerm, titleCase } from "@/lib/terminology/keys";
import { MemberCreateForm } from "@/components/member-create-form";

export default async function NewMemberPage() {
  const [locations, terminology] = await Promise.all([
    listLocationsAction(),
    // L3 audit — the page heading and the form's guardian copy
    // both route through the closed-key resolver.
    getTerminologyAction(),
  ]);

  return (
    <main className="px-5 pt-10 pb-8">
      <h1 className="font-display text-[19px] font-semibold">
        Add {titleCase(resolveTerm(terminology, "member", 1))}
      </h1>
      <div className="mt-4">
        <MemberCreateForm locations={locations} terminology={terminology} />
      </div>
    </main>
  );
}
