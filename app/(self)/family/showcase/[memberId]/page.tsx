import { notFound } from "next/navigation";
import { resolveScopedSelfScope } from "@/lib/auth/self-scope";
import { NotFoundError } from "@/lib/auth/context";
import { readShowcaseState } from "@/lib/services/showcase/state";
import { readSelfHome } from "@/lib/services/self-home";
import { Button } from "@/components/ui/Button";
import { BackLink } from "@/components/ui/BackLink";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { Input } from "@/components/ui/Input";
import { Label } from "@/components/ui/Label";

export const dynamic = "force-dynamic";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

function refusalText(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const text = raw.replace(CONTROL_CHARS, " ").trim().slice(0, 200);
  return text.length > 0 ? text : null;
}

export default async function FamilyShowcasePage({
  params,
  searchParams,
}: {
  params: Promise<{ memberId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { memberId } = await params;
  const query = await searchParams;
  if (!UUID_RE.test(memberId)) notFound();

  const resolver = await resolveScopedSelfScope("guardian");
  if (!resolver) notFound();

  let state;
  let childName: string | undefined;
  let memberCode: string | undefined;
  try {
    const result = await resolver.read(async (tx, scope) => {
      const state = await readShowcaseState(tx, scope);
      if (!state.subjects.some((entry) => entry.memberId === memberId)) return { state, childName: undefined, memberCode: undefined };
      const home = await readSelfHome(tx, scope, "guardian");
      const child = home.entries.find((entry) => entry.memberId === memberId);
      return { state, childName: child?.fullName, memberCode: child?.memberCode };
    });
    state = result.state;
    childName = result.childName;
    memberCode = result.memberCode;
  } catch (cause) {
    if (cause instanceof NotFoundError) notFound();
    throw cause;
  }

  const subject = state.subjects.find((entry) => entry.memberId === memberId);
  if (!subject || !childName) notFound();

  const refused = refusalText(query.refused);
  const canApprove = subject.allowedActions.includes("approve");
  const canTakeDown = subject.allowedActions.includes("revoke");
  const needsName = !subject.chosenName;

  return (
    <main className="mx-auto w-full max-w-xl px-4 pb-8 pt-4">
      <BackLink href="/family" label="Family home" />
      <header>
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">Achievements page</h1>
        <p className="mt-1 break-words text-[15px] font-medium text-ink">
          {childName}
          {memberCode ? <span className="ml-2 text-[12px] font-normal text-ink-3">Member code {memberCode}</span> : null}
        </p>
        <p className="mt-2 max-w-[56ch] text-[13px] leading-relaxed text-ink-2">
          The page can show skills recorded by the club’s coaches. Your child’s own choice about publishing still applies.
        </p>
      </header>

      {refused ? (
        <p role="status" className="mt-4 rounded-ctl border border-line bg-paper px-4 py-3 text-[13px] text-ink-2">
          {refused}
        </p>
      ) : null}

      <section aria-labelledby="publication-status" className="mt-4 rounded-card border border-line bg-paper p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="publication-status" className="text-[16px] font-semibold text-ink">Publication status</h2>
          <StatusBadge tone={subject.publicPath ? "good" : "neutral"}>{subject.publicPath ? "Public" : "Private"}</StatusBadge>
        </div>
        <p className="mt-2 text-[13px] text-ink-2">{subject.reason}</p>
        {subject.chosenName ? (
          <p className="mt-2 text-[13px] text-ink-2">
            Public name <strong className="break-words text-ink">{subject.chosenName}</strong>
          </p>
        ) : null}
        {subject.publicPath ? (
          <a href={subject.publicPath} target="_blank" rel="noopener noreferrer"
            className="mt-1 inline-flex min-h-11 items-center font-medium text-water underline">
            View public page
          </a>
        ) : null}
        {!canApprove && !canTakeDown && subject.isMinor === false ? (
          <p className="mt-2 text-[13px] text-ink-2">This member is an adult and can manage their own page.</p>
        ) : null}
      </section>

      {canApprove && !subject.publicPath ? (
        <section aria-labelledby="public-approval" className="mt-3 rounded-card border border-line bg-paper p-4">
          <h2 id="public-approval" className="text-[16px] font-semibold text-ink">Public name and approval</h2>
          <form method="post" action="/api/self/showcase" className="mt-2 space-y-3">
            <input type="hidden" name="action" value="approve" />
            <input type="hidden" name="memberId" value={memberId} />
            {needsName ? (
              <div className="space-y-2">
                <p id="public-name-help" className="text-[13px] leading-relaxed text-ink-2">
                  Check the spelling before approving. The public name cannot be changed after it is set, even if you take the page down.
                  Only the chosen name appears on the public page.
                </p>
                <Label htmlFor="chosenName" required>Public name</Label>
                <Input id="chosenName" name="chosenName" maxLength={60} required aria-describedby="public-name-help" />
              </div>
            ) : null}
            <p className="text-[12px] leading-relaxed text-ink-2">
              If another linked guardian withdrew approval, the page stays private until that guardian approves again.
            </p>
            <Button type="submit" variant="primary">Approve the page</Button>
          </form>
        </section>
      ) : null}

      {canTakeDown ? (
        <section aria-labelledby="privacy-choice" className="mt-3 rounded-card border border-line bg-paper p-4">
          <h2 id="privacy-choice" className="text-[16px] font-semibold text-ink">Privacy choice</h2>
          <form method="post" action="/api/self/showcase" className="mt-2">
            <input type="hidden" name="action" value="revoke" />
            <input type="hidden" name="memberId" value={memberId} />
            <Button type="submit" variant={subject.publicPath ? "destructive" : "secondary"}>
              {subject.publicPath ? "Take the page down" : "Keep the page private"}
            </Button>
          </form>
        </section>
      ) : null}
    </main>
  );
}
