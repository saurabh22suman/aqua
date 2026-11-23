import { useId, type ReactNode } from "react";

export function ProvisioningReview({
  title,
  fields,
  children,
}: {
  title: string;
  fields: ReadonlyArray<{ label: string; value: string }>;
  children: ReactNode;
}) {
  const heading = useId();

  return (
    <section aria-labelledby={heading} className="rounded-card border border-line bg-deck/50 p-4">
      <h3 id={heading} className="font-display text-base font-semibold text-ink">{title}</h3>
      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
        {fields.map(({ label, value }) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-ink-3">{label}</dt>
            <dd className="break-words text-sm font-medium text-ink">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 border-t border-line pt-3 text-[13px] text-ink-2">{children}</p>
    </section>
  );
}
