"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { MarkNoticeRead } from "./mark-notice-read";

// The server action remains the form action for the no-JS path. With JS,
// the submit handler keeps the notice visible if the response is lost.
export function MemberNoticeReadForm({ action, id, title, inboxHref }: {
  action: (form: FormData) => Promise<void>;
  id: string;
  title: string;
  inboxHref: string;
}) {
  const [pending, startTransition] = useTransition();
  const [failed, setFailed] = useState(false);
  const submitting = useRef(false);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const form = new FormData(event.currentTarget);
    submitting.current = true;
    setFailed(false);
    startTransition(async () => {
      try {
        await action(form);
      } catch {
        setFailed(true);
      } finally {
        submitting.current = false;
      }
    });
  }

  return (
    <form action={action} onSubmit={submit}>
      <input type="hidden" name="notificationId" value={id} />
      <MarkNoticeRead title={title} marking={pending} />
      {failed ? (
        <div className="mt-2 rounded-ctl border border-line bg-deck p-3 text-[13px] text-ink-2">
          <p role="alert">Could not confirm whether this announcement was marked read.</p>
          <a href={inboxHref} className="inline-flex min-h-11 items-center font-semibold text-accent-ink underline underline-offset-2">Check announcements</a>
        </div>
      ) : null}
    </form>
  );
}
