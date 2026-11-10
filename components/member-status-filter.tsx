// The Members directory's status filter — a visible row of chips.
//
// PRESENTATION ONLY. The board owns the filter's state, the navigation
// state it saves and the re-read it triggers; this file draws the
// options and reports a choice. It holds no state of its own, so the
// chip row can never disagree with the list it filters.
//
// The options are the REAL member statuses plus "All", which is every
// status and not an invented one. There is no "On hold": a member is
// trial, active, paused, lapsed or left.

export type MemberStatusOption = {
  /** The status value the read uses; "" is every status. */
  value: string;
  /** The visible word on the chip. */
  label: string;
};

export function MemberStatusFilter({
  options,
  value,
  onChange,
}: {
  options: MemberStatusOption[];
  /** The current status value ("" for every status). */
  value: string;
  /** Reports the chosen status. The caller owns what happens next. */
  onChange: (value: string) => void;
}) {
  return (
    <div className="w-full min-w-0">
      {/* The status filter is a VISIBLE, labelled row of chips — the
          approved mock's shape. A native dropdown hides its options
          behind a closed control on a phone, and the options ARE the
          filter. */}
      <span
        id="members-status-label"
        className="mb-1.5 block text-[12.5px] font-medium text-ink-2"
      >
        Status
      </span>
      {/* The six statuses are a VISIBLE, labelled set of chips. Every
          chip is a 44×44 target in BOTH directions, and the set never
          scrolls sideways.

          Below 24rem the six chips are a BALANCED three-column grid —
          two rows of three, so a narrow phone never strands one chip
          alone on a second row. From 24rem the same chips become one
          compact row that fits on a single line (six chips and five
          4px gaps need 351px, and a 390px phone has 358px). */}
      <div
        role="group"
        aria-labelledby="members-status-label"
        data-testid="members-status-filter"
        className="grid grid-cols-3 gap-2 min-[24rem]:flex min-[24rem]:flex-wrap min-[24rem]:gap-1"
      >
        {options.map((option) => {
          const selected = value === option.value;
          return (
            <button
              key={option.value || "all"}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
              className={`min-h-11 min-w-11 w-full shrink-0 rounded-ctl border px-2.5 py-2 text-center text-[13px] font-medium min-[24rem]:w-auto ${
                selected
                  ? "border-[var(--accent-strong)] bg-[var(--control-surface-action)] text-[var(--accent-ink)]"
                  : "border-line bg-paper text-ink-2"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
