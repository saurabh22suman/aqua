import { AlertCircle, CheckCircle2, Info } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "./cn";

// UI foundation — Inline feedback.
//
// The message that sits beside the thing it is about: a form error, a
// confirmation, a notice. An error is announced (role="alert"); a
// confirmation or notice is announced politely (role="status").
//
// Neutral styling on purpose: the good/late/warn colours are reserved
// for money and attendance state (DESIGN.md §1.1), so a form error
// never wears them — the words and the icon carry the meaning. This is
// the same rule components/ui/FieldError.tsx follows.

export type InlineFeedbackProps = {
  tone?: "neutral" | "success" | "error";
  children: ReactNode;
  className?: string;
};

export function InlineFeedback({
  tone = "neutral",
  children,
  className,
}: InlineFeedbackProps) {
  const Icon = tone === "success" ? CheckCircle2 : tone === "error" ? AlertCircle : Info;
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-ctl border border-line bg-deck px-3 py-2 text-[13px] text-ink-2",
        className,
      )}
    >
      <Icon
        size={15}
        strokeWidth={1.8}
        aria-hidden="true"
        className="mt-0.5 flex-none text-ink-3"
      />
      <span>{children}</span>
    </p>
  );
}
