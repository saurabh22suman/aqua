import UserRound from "lucide-react/dist/esm/icons/user-round.mjs";
import { InlineEditField, type InlineEditFieldName, type InlineEditFieldType, type InlineEditFieldOption } from "@/components/member-detail/inline-edit-field";
import type { getMemberDetailAction } from "@/lib/actions/people";

type Member = NonNullable<Awaited<ReturnType<typeof getMemberDetailAction>>>;

export function OwnerMemberPersonalDetails({ member, canWrite }: { member: Member; canWrite: boolean }) {
  const fields: { label: string; field: InlineEditFieldName; type: InlineEditFieldType; value: string; options?: InlineEditFieldOption[] }[] = [
    { label: "Name", field: "fullName", type: "text", value: member.fullName },
    { label: "Phone", field: "phone", type: "text", value: member.phone ?? "" },
    { label: "Date of birth", field: "dateOfBirth", type: "date", value: member.dateOfBirth ?? "" },
    { label: "Gender", field: "gender", type: "select", value: member.gender ?? "", options: [{ value: "male", label: "Male" }, { value: "female", label: "Female" }, { value: "other", label: "Other" }] },
    { label: "Medical notes", field: "medicalNotes", type: "textarea", value: member.medicalNotes ?? "" },
  ];
  return <section aria-labelledby="personal-details-heading" className="rounded-[18px] border border-line bg-paper p-[18px] lg:p-5">
    <div className="flex items-center gap-3 rounded-ctl bg-[var(--accent-soft)] px-3 py-2 text-[var(--accent-ink)]"><UserRound className="shrink-0" size={18} aria-hidden="true" /><h2 id="personal-details-heading" className="font-display text-[18px] font-semibold text-ink">Personal details</h2></div>
    <dl className="mt-3 divide-y divide-line">{fields.map(({ label, field, type, value, options }) => <div key={field} className="min-w-0 py-2"><dt className="text-[12px] text-ink-3">{label}</dt><dd><InlineEditField value={value} field={field} memberId={member.memberId} type={type} options={options} formatAs={field === "phone" ? "phone" : undefined} readOnly={!canWrite} alwaysShowEdit explicitCommit ownerRow /></dd></div>)}</dl>
  </section>;
}
