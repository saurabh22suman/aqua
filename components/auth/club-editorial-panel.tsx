import ClipboardCheck from "lucide-react/dist/esm/icons/clipboard-check.mjs";
import MessageCircle from "lucide-react/dist/esm/icons/message-circle.mjs";
import ReceiptIndianRupee from "lucide-react/dist/esm/icons/receipt-indian-rupee.mjs";
import { BrandLockup } from "./sports-mark";
import { LoginCharacter } from "./login-character";

// The desktop side panel of the tenant entry.
//
// Editorial, not a dashboard and not a pitch: the brand, one headline,
// one supporting sentence and three factual lines about what the
// product does for a club. No pricing, no social proof, no third-party
// sign-in, no invented numbers.
//
// The surface is the preset's pastel (--surface-sidebar), so the panel
// reads as a calm tinted plane behind the ink in both presets.
//
// The vertical rhythm is one flex column: the brand at the top, the
// headline group floating in the middle (auto margins), the quiet
// capability list anchored at the bottom.
//
// It is hidden below `lg`: on a phone the form is the whole screen and
// nothing may push it down (DESIGN.md §2 — mobile first, always).

const CAPABILITIES = [
  {
    icon: ClipboardCheck,
    label: "Mark attendance in one tap",
  },
  {
    icon: ReceiptIndianRupee,
    label: "Collect fees against invoices",
  },
  {
    icon: MessageCircle,
    label: "Reach parents on WhatsApp",
  },
] as const;

export function ClubEditorialPanel() {
  return (
    <aside
      aria-label="About Aqua"
      className="hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col lg:overflow-hidden lg:bg-[var(--surface-sidebar)] lg:px-12 lg:py-10 xl:px-16 xl:py-12"
    >
      <BrandLockup />

      <div className="my-auto py-10">
        <h2 className="max-w-[22ch] font-display text-[30px] font-semibold leading-[1.15] text-balance text-ink xl:text-[34px]">
          One desk for the whole club.
        </h2>
        <p className="mt-3 max-w-[40ch] text-[15px] leading-relaxed text-ink-2">
          Attendance, fees and parent messages — for coaches, reception and
          owners.
        </p>
        <LoginCharacter />
      </div>

      <ul className="space-y-2.5">
        {CAPABILITIES.map(({ icon: Icon, label }) => (
          <li
            key={label}
            className="flex items-center gap-2.5 border-t border-line pt-2.5 text-[13px] text-ink-2"
          >
            <Icon
              size={16}
              strokeWidth={1.8}
              aria-hidden="true"
              className="flex-none text-ink-3"
            />
            <span>{label}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}
