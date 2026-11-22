import Layers from "lucide-react/dist/esm/icons/layers.mjs";
import { enrolmentFacilityLabel } from "@/components/member-detail/enrolment-facility-label";
import { MemberManagementLink } from "@/components/member-detail/member-management-link";
import type { MemberEnrolmentSeed } from "@/components/member-detail/member-panel-initial-data";

export function OwnerMemberBatches({ enrolment, canWrite, canReadPrograms, batchLabel }: { enrolment: MemberEnrolmentSeed; canWrite: boolean; canReadPrograms: boolean; batchLabel: string }) {
  return <section aria-labelledby="member-batches-heading" className="rounded-[18px] border border-line bg-paper p-[18px] lg:p-5">
    <div className="flex flex-wrap items-center justify-between gap-x-3"><div className="flex items-center gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-ctl bg-[var(--accent-soft)] text-[var(--accent-ink)]"><Layers size={18} aria-hidden="true" /></span><h2 id="member-batches-heading" className="font-display text-[18px] font-semibold text-ink">Batches</h2></div>{(canWrite && canReadPrograms) || "failed" in enrolment ? <MemberManagementLink target="enrolment">{canWrite && canReadPrograms ? "Manage batches" : "View batch read error"}</MemberManagementLink> : null}</div>
    {"failed" in enrolment ? <p className="mt-3 text-[13px] text-ink-3">{batchLabel} information is unavailable.</p> : enrolment.enrolments.length === 0 ? <p className="mt-3 text-[13px] text-ink-3">No batches enrolled.</p> : <ul className="mt-3 divide-y divide-line">{enrolment.enrolments.map((item) => <li key={item.batchId} className="min-w-0 py-3"><p className="break-words [overflow-wrap:anywhere] text-[14px] font-medium text-ink">{item.batchName}</p><div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[12px] text-ink-3"><span className="min-w-0 break-words [overflow-wrap:anywhere]">{item.programName}</span>{canReadPrograms ? <span className="min-w-0 break-words [overflow-wrap:anywhere]">{enrolmentFacilityLabel(item.batchId, enrolment.batches)}</span> : null}</div></li>)}</ul>}
  </section>;
}
