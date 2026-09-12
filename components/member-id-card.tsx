import { TenantMark } from "@/components/branding/tenant-mark";
import { buildMemberIdPayload, renderMemberIdQrSvg } from "@/lib/members/id-card";
import {
  resolveTerm,
  titleCase,
  type TerminologyState,
} from "@/lib/terminology/keys";

// §5.2 — Member identity card. Operator-printed identity artifact.
// What the card says — and does NOT say — was approved explicitly:
//   - "this person is a member of <club>"
//   - member code, member name, club mark
//   - QR encoding the §5.2 payload (decoded by V-21 later, separately)
// What it deliberately does not say:
//   - "scan to check in", "member pass", "show at the gate", "tap to
//     enter". Any copy that implies a scanning workflow is wrong until
//     V-21 ships — and even then, the gate scanner should not be the
//     card's primary job. The card is identity, not a ticket.
// The copy here is plain: name, code, club, member. The QR is there
// because it costs nothing to render and V-21 will need it; not
// because reading the card should make anyone expect something to
// happen automatically.
//
// The "Member" eyebrow above the tenant name is the L3 audit's
// third instance of hardcoded prose: a swim tenant renders
// "Swimmer" above its club, every other tenant renders "Member".
// The same closed-key resolver that already owns the
// owner-dashboard and coach/members text is the only honest
// source. The source-scan in tests/tier1/vocab-source-scan.test.ts
// gates the fix; it matches a JSX literal with no `{` on the line,
// so the JSX interpolation `{titleCase(...)}` is automatically
// exempt — the gate is on the static source, not on runtime DOM.
export async function MemberIdCard({
  tenantSlug,
  tenantDisplayName,
  tenantAccent,
  initials,
  memberFullName,
  memberCode,
  memberUuid,
  terminology,
}: {
  tenantSlug: string;
  tenantDisplayName: string;
  tenantAccent:
    | "mango"
    | "marine"
    | "indigo"
    | "plum"
    | "forest"
    | "slate";
  initials: string;
  memberFullName: string;
  memberCode: string;
  memberUuid: string;
  terminology: TerminologyState;
}) {
  const payload = buildMemberIdPayload(tenantSlug, memberUuid);
  const qrSvg = await renderMemberIdQrSvg(payload);

  return (
    <article
      className="id-card rounded-card bg-paper border border-line p-5"
      data-testid="member-id-card"
      data-print-isolate="member-id-card"
    >
      <header className="flex items-center gap-3 pb-3 border-b border-line">
        <TenantMark initials={initials} accent={tenantAccent} size={48} />
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-ink-3">
            {titleCase(resolveTerm(terminology, "member", 1))}
          </p>
          <p className="font-display text-[15px] font-semibold leading-tight truncate">
            {tenantDisplayName}
          </p>
        </div>
      </header>

      <div className="mt-4">
        <p
          className="font-display text-[19px] font-semibold leading-tight"
          data-testid="id-card-name"
        >
          {memberFullName}
        </p>
        <p className="mt-1 text-[12.5px] text-ink-3 font-mono" data-testid="id-card-code">
          {memberCode}
        </p>
      </div>

      {/* F23 (mobile UX plan v2): the QR sat above the h1 and always
          rendered, pushing status/attendance below the fold. Native
          <details> collapses it with zero client JS. */}
      <details className="mt-4" data-testid="id-card-qr-details">
        <summary className="inline-flex min-h-11 cursor-pointer list-none items-center text-[12.5px] font-medium text-ink-3 hover:text-ink">
          Show identity card
        </summary>
        <div
          className="mt-3 mx-auto w-[160px] h-[160px] flex items-center justify-center"
          // qrcode's SVG output is plain markup — no scripts, no event
          // handlers, no <foreignObject>. dangerouslySetInnerHTML on a
          // QR-shaped SVG is safe; the SVG is the only visible content.
          dangerouslySetInnerHTML={{ __html: qrSvg }}
          aria-label="Identity code for this membership"
          role="img"
        />
      </details>

      <p className="mt-3 text-[11px] text-ink-3 text-center">
        Identity card &middot; {tenantDisplayName}
      </p>
    </article>
  );
}
