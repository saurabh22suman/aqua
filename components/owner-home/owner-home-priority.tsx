import { OwnerLink as Link } from "@/components/owner-ui/owner-link";
import { OwnerIcon } from "@/components/owner-ui/owner-icon";
import type { NeedsAttentionItem } from "@/lib/services/dashboard";

// Owner Today — the warm "Needs attention" strip under the stage.
//
// It carries the ONE priority the service put first, and a single
// already-authorized action. On a quiet day it keeps the same shape but
// says so plainly; it never draws an action that has no destination.
export function OwnerHomePriority({
  item,
  detail,
  action,
  actionHref,
  className,
}: {
  item: NeedsAttentionItem | null;
  detail?: string;
  /** The verb the real destination earns ("Review", "Open overdue invoices", …). */
  action: string;
  actionHref?: string;
  /** The shared markup-contract classes; the quiet modifier is added here. */
  className: string;
}) {
  return (
    <section
      className={`${className}${item ? "" : " floodlit-quiet quiet"}`}
      aria-labelledby="owner-priority-heading"
      data-testid="owner-home-priority"
    >
      <span className="floodlit-priority-icon priority-icon" aria-hidden="true">
        <OwnerIcon name="alert" size={20} />
      </span>
      <div className="floodlit-priority-body">
        <p className="floodlit-priority-context priority-context">Needs attention</p>
        {item ? (
          <>
            <h2 id="owner-priority-heading">{item.title}</h2>
            {detail ? <p className="floodlit-priority-detail priority-detail">{detail}</p> : null}
          </>
        ) : (
          <h2 id="owner-priority-heading">Nothing needs your attention today</h2>
        )}
      </div>
      {item && actionHref ? (
        <Link
          className="floodlit-action button primary"
          href={actionHref}
          aria-label={action === "Review" ? `Review ${item.title}` : undefined}
        >
          {action} <OwnerIcon name="chevron" size={16} />
        </Link>
      ) : null}
    </section>
  );
}
