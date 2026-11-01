import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";

export function PaymentAmountField({
  id,
  value,
  onChange,
  testId,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  testId?: string;
}) {
  return (
    <Field id={id} label="Amount (₹)">
      {(field) => (
        <Input
          {...field}
          id={id}
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          data-testid={testId}
        />
      )}
    </Field>
  );
}
