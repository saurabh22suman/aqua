import { notFound } from "next/navigation";
import { resolveSelfScope } from "@/lib/auth/self-scope";
import { NotFoundError } from "@/lib/auth/context";
import { readSelfNotificationsInTx, type NotificationRow } from "@/lib/services/announcements";
import { markSelfNotificationAction } from "@/lib/actions/self-notifications";
import { formatDateTimeIST } from "@/lib/time/tz";
import { SelfWorkspaceNav } from "@/components/self-workspace-nav";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { buttonClasses } from "@/components/ui/Button";
import { MemberNoticeReadForm } from "./member-notice-read-form";

export async function SelfInboxPage({ audience }: { audience: "member" | "guardian" }) {
  const resolver = await resolveSelfScope(audience, null);
  if (!resolver) notFound();
  const ownInbox = audience === "member";
  const home = ownInbox ? "/member" : "/family";
  const inboxHref = `${home}/announcements`;
  const rows = await resolver.read((tx, scope) => readSelfNotificationsInTx(tx, scope)).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    return null;
  });
  const mark = markSelfNotificationAction.bind(null, audience);
  const unread = (rows ?? []).filter((row) => row.readAt === null);
  const earlier = (rows ?? []).filter((row) => row.readAt !== null);

  function section(rows: NotificationRow[], label: string, id: string) {
    if (!rows.length) return null;
    return (
      <section aria-labelledby={id} className="min-w-0 rounded-card border border-line bg-paper p-4">
        <h2 id={id} tabIndex={ownInbox ? -1 : undefined} className="scroll-mt-4 text-base font-semibold">{label}</h2>
        <ul className="mt-2 divide-y divide-line">
          {rows.map((row) => (
            <li key={row.id} className="space-y-2 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="break-words font-semibold">{row.title}</h3>
                {row.readAt ? <StatusBadge tone="neutral">Read</StatusBadge> : null}
              </div>
              <p className="whitespace-pre-wrap break-words text-sm text-ink-2">{row.body}</p>
              <time className="block text-xs text-ink-2" dateTime={row.createdAt}>{formatDateTimeIST(row.createdAt)}</time>
              {row.readAt ? null : (
                <MemberNoticeReadForm action={mark} id={row.id} title={row.title} inboxHref={inboxHref} />
              )}
            </li>
          ))}
        </ul>
      </section>
    );
  }

  return (
    <main className="self-page">
      <div className="self-main pb-8 [overflow-wrap:anywhere]">
        <SelfWorkspaceNav home={home} current="announcements" />
        <header className="min-w-0">
          <h1 className="text-2xl font-bold">Announcements</h1>
          {rows?.length ? <p role="status" className="mt-1 text-sm text-ink-2">{unread.length ? `${unread.length} unread` : "All caught up"}</p> : null}
        </header>
        {ownInbox && unread.length > 0 && earlier.length > 0 ? (
          <nav aria-label="Announcement sections" className="self-shortcuts">
            <a href="#unread-announcements">Unread</a>
            <a href="#earlier-announcements">Previously read</a>
          </nav>
        ) : null}
        {rows === null ? (
          <section className="rounded-card border border-line bg-paper p-4">
            <p role="alert" className="mb-2 text-sm">Could not load announcements.</p>
            <a href={inboxHref} className={buttonClasses({ size: "sm" })}>Retry announcements</a>
          </section>
        ) : !rows.length ? (
          <p className="rounded-card border border-line bg-paper p-4 text-sm text-ink-2">No announcements yet. Club updates sent to you will appear here.</p>
        ) : (
          <>
            {section(unread, "Unread announcements", "unread-announcements")}
            {section(earlier, "Previously read", "earlier-announcements")}
          </>
        )}
      </div>
    </main>
  );
}
