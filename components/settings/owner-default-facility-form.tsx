"use client";

import { useActionState, useState } from "react";
import { saveOwnerDefaultFacilityAction } from "@/lib/actions/owner-default-facility";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";

export function OwnerDefaultFacilityForm({
  selected,
  facilities,
}: {
  selected: string;
  facilities: readonly { id: string; name: string }[];
}) {
  const [facility, setFacility] = useState(selected);
  const [state, action, pending] = useActionState(saveOwnerDefaultFacilityAction, {});
  return (
    <form action={action} className="mt-5 max-w-lg space-y-3 rounded-card border border-line bg-paper p-4">
      <section aria-label="Saved default facility" className="owner-work-panel" aria-live="polite">
        <h2 className="text-sm font-medium text-ink-2">Saved default</h2>
        <p className="mt-1 font-semibold">{facilities.find(entry => entry.id === selected)?.name ?? "All facilities"}</p>
      </section>
      <label htmlFor="starting-facility" className="block text-sm font-semibold">Open the app at</label>
      <Select id="starting-facility" name="facility" value={facility} onChange={(event) => setFacility(event.target.value)} aria-describedby="default-facility-help">
        <option value="all">All facilities</option>
        {facilities.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
      </Select>
      <p id="default-facility-help" className="text-sm text-ink-2">Used when you sign in to this business on this device. You can switch facilities any time.</p>
      {state.error ? <p role="alert" className="text-sm text-ink">{state.error}</p> : null}
      {state.saved ? <p role="status" className="text-sm text-ink">Default facility saved.</p> : null}
      <Button type="submit" disabled={pending}>{pending ? "Saving…" : "Save preference"}</Button>
    </form>
  );
}
