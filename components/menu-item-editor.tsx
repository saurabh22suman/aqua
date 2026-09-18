"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import {
  displayRupeeAmount,
  displayTaxPercent,
  ItemFields,
  parseTaxBp,
  readItemFields,
} from "@/components/menu-item-fields";
import {
  archiveMenuItemAction,
  createMenuItemAction,
  updateMenuItemAction,
} from "@/lib/actions/menu";
import { formatINR } from "@/lib/money/format";
import { parseRupeesToPaise } from "@/lib/payment-qr";
import type { MenuItemRow } from "@/lib/services/menu";

// K-07 — owner/admin café menu items. Every mutation goes through
// the K-01 actions (settings.manage); this file only parses the
// form strings into the service shapes via menu-item-fields.

function invalidFieldMessage(price: string, tax: string): string | null {
  if (parseRupeesToPaise(price) === null) {
    return "Enter a price like 250 or 250.50.";
  }
  if (parseTaxBp(tax) === null) {
    return "Enter a GST rate between 0 and 100.";
  }
  return null;
}

export function AddItemForm({ categoryId }: { categoryId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = readItemFields(form);
    const problem = invalidFieldMessage(fields.price, fields.tax);
    if (problem) {
      setOk(false);
      setMessage(problem);
      return;
    }
    const pricePaise = parseRupeesToPaise(fields.price);
    const taxRateBp = parseTaxBp(fields.tax);
    if (pricePaise === null || taxRateBp === null) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await createMenuItemAction({
        categoryId,
        name: fields.name,
        pricePaise: Number(pricePaise),
        taxRateBp,
        sacCode: fields.sac,
        isVeg: fields.veg,
      });
      setOk(result.ok);
      setMessage(result.ok ? "Item added." : result.error);
      if (result.ok) {
        form.reset();
        router.refresh();
      }
    } catch {
      setOk(false);
      setMessage("The item could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      className="mt-3 rounded-ctl border border-line bg-paper p-3 space-y-3"
      data-testid={`menu-add-item-${categoryId}`}
    >
      <ItemFields testPrefix={`menu-new-item-${categoryId}`} />
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" size="md" disabled={busy}>
          {busy ? "Saving…" : "Add item"}
        </Button>
        {message ? (
          <span role={ok ? "status" : "alert"} className="text-[12px] text-ink-2">
            {message}
          </span>
        ) : null}
      </div>
    </form>
  );
}

export function MenuItemEditor({ item }: { item: MenuItemRow }) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function toggleActive() {
    setBusy(true);
    setMessage(null);
    try {
      const result = await updateMenuItemAction({
        itemId: item.id,
        isActive: !item.isActive,
      });
      setMessage(result.ok ? "Updated." : result.error);
      if (result.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = readItemFields(event.currentTarget);
    const problem = invalidFieldMessage(fields.price, fields.tax);
    if (problem) {
      setMessage(problem);
      return;
    }
    const pricePaise = parseRupeesToPaise(fields.price);
    const taxRateBp = parseTaxBp(fields.tax);
    if (pricePaise === null || taxRateBp === null) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await updateMenuItemAction({
        itemId: item.id,
        name: fields.name,
        pricePaise: Number(pricePaise),
        taxRateBp,
        sacCode: fields.sac,
        isVeg: fields.veg,
      });
      setMessage(result.ok ? "Saved." : result.error);
      if (result.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (!window.confirm(`Archive "${item.name}"?`)) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await archiveMenuItemAction({ itemId: item.id });
      setMessage(result.ok ? "Archived." : result.error);
      if (result.ok) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="py-3" data-testid={`menu-item-${item.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[14px] font-medium text-ink">
          {item.name}
          <span className="ml-2 text-[12px] text-ink-3">
            {formatINR(item.pricePaise)} · GST {displayTaxPercent(item.taxRateBp)}
            % · SAC {item.sacCode}
          </span>
          {item.isVeg ? (
            <span className="ml-2 rounded-pill bg-deck px-2 py-0.5 text-[11px] text-ink-2">
              Veg
            </span>
          ) : null}
          {!item.isActive ? (
            <span className="ml-2 rounded-pill bg-deck px-2 py-0.5 text-[11px] text-ink-3">
              Hidden
            </span>
          ) : null}
        </span>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="ghost" disabled={busy} onClick={toggleActive}>
            {item.isActive ? "Hide" : "Show"}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={archive}>
            Archive
          </Button>
        </div>
      </div>

      <details className="mt-1">
        <summary className="cursor-pointer text-[12px] text-[var(--accent)] underline underline-offset-2">
          Edit
        </summary>
        <form onSubmit={save} className="mt-2 space-y-3">
          <ItemFields
            testPrefix={`menu-edit-item-${item.id}`}
            defaults={{
              name: item.name,
              price: displayRupeeAmount(item.pricePaise),
              tax: displayTaxPercent(item.taxRateBp),
              sac: item.sacCode,
              veg: item.isVeg,
            }}
          />
          <div className="flex items-center gap-3">
            <Button type="submit" variant="primary" size="md" disabled={busy}>
              {busy ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </details>

      {message ? (
        <p role="status" className="mt-2 text-[12px] text-ink-2">
          {message}
        </p>
      ) : null}
    </div>
  );
}
