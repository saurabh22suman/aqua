import type { ReactNode } from "react";

// Phase 1 (mobile UX plan v2) — visible label + value + optional
// action. Replaces data lists that rendered bare values (F37) and the
// `h1`-with-edit-button anti-pattern the audit found on member detail.

export type RowProps = {
  label: string;
  value: ReactNode;
  action?: ReactNode;
};

export function Row({ label, value, action }: RowProps) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <p className="text-[12px] text-ink-3">{label}</p>
        <div className="mt-0.5 text-[14px] text-ink break-words">{value}</div>
      </div>
      {action ? <div className="flex-none">{action}</div> : null}
    </div>
  );
}
