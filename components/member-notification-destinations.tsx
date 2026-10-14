"use client";

import { useState } from "react";
import { saveNotificationDestinationsAction } from "@/lib/actions/notification-destinations";
import type { NotificationContact } from "@/lib/services/notification-destinations";

export function MemberNotificationDestinations({ memberId, contacts, communicationsAllowed, minor }: {
  memberId: string; contacts: NotificationContact[]; communicationsAllowed: boolean; minor: boolean;
}) {
  const [selected, setSelected] = useState(() => contacts.filter((c) => c.selected).map((c) => c.personId));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
    setPending(true); setMessage("");
    try {
      const result = await saveNotificationDestinationsAction({ memberId, personIds: selected });
      setMessage(result.ok ? "Notification destinations saved." : result.error);
    } catch { setMessage("Could not save destinations. Please try again."); }
    finally { setPending(false); }
  }
  return <section className="mt-4 rounded-card border border-line bg-paper p-4">
    <h2 className="font-display text-[16px] font-semibold text-ink">WhatsApp notifications</h2>
    <p className="mt-1 text-[13px] text-ink-2">Choose any linked numbers that should receive student updates. Uncheck all to stop these WhatsApp notifications.</p>
    {minor ? <p className="mt-2 text-[12px] text-ink-2">Fee and payment notices for minors go only to selected guardian numbers.</p> : null}
    {!communicationsAllowed ? <p className="mt-2 text-[13px] text-ink-2">Communications consent is not active. Optional student updates are paused.</p> : null}
    <fieldset className="mt-3" disabled={pending}><legend className="sr-only">Notification destinations</legend>
      {contacts.length === 0 ? <p className="text-[13px] text-ink-2">Add a phone number to the student or a linked guardian first.</p> :
        contacts.map((contact) => <label key={contact.personId} className="flex min-h-[48px] items-center gap-3 py-2">
          <input type="checkbox" checked={selected.includes(contact.personId)} className="h-5 w-5"
            onChange={(event) => setSelected((ids) => event.target.checked ? [...ids, contact.personId] : ids.filter((id) => id !== contact.personId))} />
          <span className="text-[14px] text-ink">{contact.name}<span className="block text-[12px] text-ink-2">{contact.relationship} · {contact.phone}</span></span>
        </label>)}
    </fieldset>
    <button type="button" onClick={save} disabled={pending || contacts.length === 0}
      className="mt-3 min-h-[44px] rounded-pill bg-[var(--accent-strong)] px-5 py-2 text-[14px] font-medium text-paper disabled:opacity-60">
      {pending ? "Saving…" : "Save destinations"}
    </button>
    {message ? <p role="status" className="mt-2 text-[13px] text-ink-2">{message}</p> : null}
  </section>;
}
