"use client";

// K-07 — shared menu-item form fields and their parsing. The
// conversions are integer arithmetic: rupees → paise via the shared
// parseRupeesToPaise (never parseFloat), percent → basis points by
// string split, never a float multiply.

export const inputClass =
  "w-full min-h-11 rounded-ctl border border-line bg-paper px-3 py-2 text-[16px] text-ink focus:border-[var(--accent-strong)] focus:outline-none";

export function parseTaxBp(raw: string): number | null {
  const text = raw.trim();
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const whole = Number(match[1]);
  const decimals = (match[2] ?? "").padEnd(2, "0");
  const bp = whole * 100 + Number(decimals || "0");
  return bp <= 10000 ? bp : null;
}

function percentInput(bp: number): string {
  const whole = Math.floor(bp / 100);
  const remainder = bp % 100;
  return remainder === 0
    ? String(whole)
    : `${whole}.${String(remainder).padStart(2, "0")}`;
}

function rupeesInput(paise: number): string {
  const whole = Math.floor(paise / 100);
  const remainder = paise % 100;
  return remainder === 0
    ? String(whole)
    : `${whole}.${String(remainder).padStart(2, "0")}`;
}

export function displayTaxPercent(bp: number): string {
  return percentInput(bp);
}

export function displayRupeeAmount(paise: number): string {
  return rupeesInput(paise);
}

export function ItemFields({
  defaults,
  testPrefix,
}: {
  defaults?: {
    name: string;
    price: string;
    tax: string;
    sac: string;
    veg: boolean;
  };
  testPrefix: string;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <label className="block">
        <span className="block text-[12px] font-medium text-ink-2 mb-1">
          Name
        </span>
        <input
          name="name"
          defaultValue={defaults?.name}
          placeholder="Masala chai"
          maxLength={120}
          className={inputClass}
          data-testid={`${testPrefix}-name`}
        />
      </label>
      <label className="block">
        <span className="block text-[12px] font-medium text-ink-2 mb-1">
          Price (₹)
        </span>
        <input
          name="price"
          defaultValue={defaults?.price}
          inputMode="decimal"
          placeholder="250"
          className={inputClass}
          data-testid={`${testPrefix}-price`}
        />
      </label>
      <label className="block">
        <span className="block text-[12px] font-medium text-ink-2 mb-1">
          GST rate (%)
        </span>
        <input
          name="tax"
          defaultValue={defaults?.tax}
          inputMode="decimal"
          placeholder="5"
          className={inputClass}
          data-testid={`${testPrefix}-tax`}
        />
      </label>
      <label className="block">
        <span className="block text-[12px] font-medium text-ink-2 mb-1">
          SAC code
        </span>
        <input
          name="sac"
          defaultValue={defaults?.sac}
          inputMode="numeric"
          placeholder="996331"
          className={inputClass}
          data-testid={`${testPrefix}-sac`}
        />
      </label>
      <label className="flex items-center gap-2 min-h-[44px]">
        <input
          type="checkbox"
          name="veg"
          defaultChecked={defaults?.veg}
          className="h-5 w-5"
          data-testid={`${testPrefix}-veg`}
        />
        <span className="text-[14px] text-ink">Veg item</span>
      </label>
    </div>
  );
}

export function readItemFields(form: HTMLFormElement) {
  const data = new FormData(form);
  return {
    name: String(data.get("name") ?? "").trim(),
    price: String(data.get("price") ?? "").trim(),
    tax: String(data.get("tax") ?? "").trim(),
    sac: String(data.get("sac") ?? "").trim(),
    veg: data.get("veg") === "on",
  };
}
