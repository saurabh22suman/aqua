import { listLocationsAction } from "@/lib/actions/people";
import { getTerminologyAction } from "@/lib/actions/terminology";
import { resolveTerm } from "@/lib/terminology/keys";
import { MemberCreateForm } from "@/components/member-create-form";
import { requireReception } from "@/lib/auth/surface-guard";

export default async function ReceptionNewMemberPage() {
  await requireReception();
  const [locations, terminology] = await Promise.all([
    listLocationsAction(),
    // L3 audit — the page heading and the form's guardian copy
    // both route through the closed-key resolver.
    getTerminologyAction(),
  ]);

  return (
    <main className="px-5 pt-10 pb-8">
      {/* Sentence case (DESIGN.md §4): the term is already the
          tenant-resolved noun, so titleCase() on top produced
          "Add Swimmer" (audit R-D5). */}
      <h1 className="font-display text-[19px] font-semibold">
        Add {resolveTerm(terminology, "member", 1)}
      </h1>
      <div className="mt-4">
        <MemberCreateForm
          locations={locations}
          memberDetailBasePath="/reception/members"
          terminology={terminology}
        />
      </div>
    </main>
  );
}