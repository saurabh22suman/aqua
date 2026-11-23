import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";
import { FieldError } from "@/components/ui/FieldError";

export function ConfirmPinField({ id, value, onChange, error }: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
}) {
  return (
    <div>
      <Label htmlFor={id}>Confirm PIN</Label>
      <Input
        id={id}
        type="password"
        value={value}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, ""))}
        inputMode="numeric"
        autoComplete="new-password"
        maxLength={12}
        placeholder="••••••"
        aria-required="true"
        invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        className="mt-1.5 min-h-[var(--control-height-lg)] text-[20px] font-display tracking-[0.3em]"
      />
      {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : null}
    </div>
  );
}
