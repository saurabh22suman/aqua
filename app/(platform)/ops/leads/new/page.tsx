import { redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";
import { NewLeadForm } from "./new-lead-form";
import { OpsPage, OpsPageHeader } from "@/components/ops/ops-primitives";
import { OpsWriteGate } from "@/components/ops/ops-display";

// Ops redesign (28 October 2026): the breadcrumb is the page frame's
// eyebrow, and the form is the shared card + shared controls.
export default async function NewLeadPage() {
  const status = await platformAuthStatusAction();
  if (status.kind !== "authenticated") redirect("/ops/login");
  const canWrite = status.role === "admin";

  return (
    <OpsPage className="max-w-[760px]">
      <OpsPageHeader eyebrow="Leads / new" title="New lead" />
      <OpsWriteGate
        canWrite={canWrite}
        note={
          <>
            Read-only: this account can browse, not change, platform data. An
            administrator captures a lead.
          </>
        }
      >
        <NewLeadForm />
      </OpsWriteGate>
    </OpsPage>
  );
}
