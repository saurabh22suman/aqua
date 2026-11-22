import { notFound } from "next/navigation";
import { resolveScopedSelfScope } from "@/lib/auth/self-scope";
import { NotFoundError } from "@/lib/auth/context";
import { readShowcaseState } from "@/lib/services/showcase/state";
import { readSelfHome } from "@/lib/services/self-home";
import { Button } from "@/components/ui/Button";
import { BackLink } from "@/components/ui/BackLink";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/Card";
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
    <main className="mx-auto w-full max-w-xl px-4 py-8">
      <BackLink href="/family" label="Family home" />
      <h1 className="font-display text-[22px] font-semibold text-marine">
        Your child&rsquo;s achievements page
      </h1>
      <p className="mt-1 text-ink-2">For {childName}{memberCode ? ` · Member code ${memberCode}` : ""}</p>
      <p className="mt-1 text-[13px] text-ink-3">
        A page with the skills the club&rsquo;s coaches recorded, under a name
        you choose. Your child&rsquo;s own choice about the page is theirs
        alone.
      </p>

      {refused ? (
        <p
          role="status"
          className="mt-4 rounded-card border border-line bg-paper px-4 py-3 text-[13px] text-ink-2"
        >
          {refused}
        </p>
      ) : null}

      <Card className="mt-5">
        <CardHeader>
          <div>
            <CardTitle>Where the page stands</CardTitle>
            <CardDescription>{subject.reason}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {subject.chosenName ? (
            <p className="text-[13px] text-ink-2">
              The page shows the name{" "}
              <span className="font-medium text-ink">{subject.chosenName}</span>
              . The name is set once, when the page is first set up.
            </p>
          ) : null}

          {subject.publicPath ? (
            <a
              href={subject.publicPath}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center text-[13px] text-ink underline"
            >
              View public page
            </a>
          ) : null}

          {canApprove && !subject.publicPath ? (
            <form
              method="post"
              action="/api/self/showcase"
              className="mt-4 flex flex-col gap-3"
            >
              <input type="hidden" name="action" value="approve" />
              <input type="hidden" name="memberId" value={memberId} />
              {needsName ? (
                <>
                  <Label htmlFor="chosenName" required>
                    The name your page will show
                  </Label>
                  <Input
                    id="chosenName"
                    name="chosenName"
                    maxLength={60}
                    placeholder="A name your child is happy to be known by"
                    required
                  />
                  <p className="text-[12px] text-ink-3">
                    This is the only name that appears. The legal name is
                    never published. Check the spelling: the name cannot be
                    changed after it is set, even if you take the page down.
                    If you need help with the name, contact your club; changing
                    it is not available in this release.
                  </p>
                </>
              ) : null}
              <Button type="submit" variant="primary">
                Approve the page
              </Button>
            </form>
          ) : null}

          {canTakeDown ? (
            <form
              method="post"
              action="/api/self/showcase"
              className="mt-4"
            >
              <input type="hidden" name="action" value="revoke" />
              <input type="hidden" name="memberId" value={memberId} />
              <Button type="submit" variant="destructive">
                {subject.publicPath ? "Take the page down" : "Keep the page private"}
              </Button>
            </form>
          ) : null}

          {!canApprove && !canTakeDown ? (
            <p className="mt-4 text-[13px] text-ink-2">
              This member is an adult now, so only their own decision counts.
              Ask them, and they can publish or take down their own page.
            </p>
          ) : null}

          {canApprove ? (
            <p className="mt-4 text-[12px] text-ink-3">
              If another linked guardian has withdrawn their agreement, the
              page stays private until that guardian approves again.
            </p>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
