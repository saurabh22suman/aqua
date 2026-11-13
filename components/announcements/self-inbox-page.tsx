import { notFound } from "next/navigation";
import { resolveSelfScope } from "@/lib/auth/self-scope";
import { readSelfNotificationsInTx } from "@/lib/services/announcements";
import { markSelfNotificationAction } from "@/lib/actions/self-notifications";
import { formatDateTimeIST } from "@/lib/time/tz";

export async function SelfInboxPage({ audience }: { audience: "member" | "guardian" }) {
  const resolver = await resolveSelfScope(audience, null);
  if (!resolver) notFound();
  const rows = await resolver.read((tx, scope) => readSelfNotificationsInTx(tx, scope));
  const mark = markSelfNotificationAction.bind(null, audience);
  return <main className="mx-auto w-full min-w-0 max-w-xl px-4 py-8 [overflow-wrap:anywhere]"><h1 className="mb-4 text-xl font-semibold text-ink">Announcements</h1>
    {rows.length === 0 ? <p>Nothing yet. Announcements sent to you appear here.</p> : <ul className="divide-y divide-line">{rows.map((row) => <li key={row.id} className="py-4"><h2 className="font-medium">{row.title}</h2><p className="whitespace-pre-wrap">{row.body}</p><p>{formatDateTimeIST(row.createdAt)}</p>{row.readAt ? <span>Read</span> : <form action={mark}><input type="hidden" name="notificationId" value={row.id} /><button className="min-h-11 underline" type="submit">Mark read</button></form>}</li>)}</ul>}
  </main>;
}
