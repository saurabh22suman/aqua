import { FileText } from "lucide-react";

// U-03 — the Documents tab. C-07 (document and photo storage) is
// unbuilt, so this is the honest empty state: state that the feature
// does not exist yet and where the closest real data lives, rather
// than an upload affordance that would go nowhere. No photo uploads
// anywhere — children's photos are DPDP-sensitive (U-09).
export function MemberDocumentsPanel() {
  return (
    <section className="mt-4 rounded-card border border-line bg-paper p-4">
      <h2 className="flex items-center gap-1.5 font-display text-[15px] font-semibold">
        <FileText size={15} className="text-ink-3" />
        Documents
      </h2>
      <p className="mt-2 text-[13px] text-ink-3">
        Document and photo storage (C-07) is not built yet, so there is
        nothing to show here. Medical notes belong on the Overview tab
        until uploads land.
      </p>
    </section>
  );
}
