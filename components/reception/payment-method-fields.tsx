"use client";

import { METHOD_LABEL, type PaymentMethodKey } from "@/lib/money/payment-groups";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";

const COUNTER_METHODS: PaymentMethodKey[] = [
  "cash",
  "upi",
  "bank_transfer",
  "card",
  "other",
];

const REFERENCE_LABEL: Record<Exclude<PaymentMethodKey, "cash">, string> = {
  upi: "UPI reference (UTR / transaction id)",
  bank_transfer: "Bank transfer reference",
  card: "Card terminal reference",
  other: "Payment reference",
};

export function PaymentMethodFields({
  method,
  setMethod,
  reference,
  setReference,
}: {
  method: PaymentMethodKey;
  setMethod: (method: PaymentMethodKey) => void;
  reference: string;
  setReference: (reference: string) => void;
}) {
  return (
    <>
      <fieldset>
        <legend className="text-[12px] font-medium text-ink-2 mb-1">
          Method
        </legend>
        <div className="flex flex-wrap gap-4">
          {COUNTER_METHODS.map((option) => (
            <label key={option} className="flex items-center gap-2 text-[13px] text-ink">
              <input
                type="radio"
                name="payment-method"
                checked={method === option}
                onChange={() => setMethod(option)}
              />
              {METHOD_LABEL[option]}
            </label>
          ))}
        </div>
      </fieldset>

      {method === "cash" ? null : (
        <Field id="payment-reference" label={REFERENCE_LABEL[method]}>
          {() => (
            <Input
              id="payment-reference"
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              data-testid="payment-reference"
            />
          )}
        </Field>
      )}
    </>
  );
}
