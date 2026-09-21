export function ReportCardError({ title }: { title: string }) {
  return (
    <article
      className="rounded-card border border-line bg-paper p-4"
      role="alert"
    >
      <h2 className="font-display text-[15px] font-semibold">{title}</h2>
      <p className="mt-2 text-[13px] text-ink-3">
        This card couldn&apos;t load. The rest of the report is still here —
        refresh to try it again.
      </p>
    </article>
  );
}
