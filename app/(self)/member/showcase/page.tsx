import { notFound } from "next/navigation";
import { resolveScopedSelfScope } from "@/lib/auth/self-scope";
import { NotFoundError } from "@/lib/auth/context";
import { readShowcaseState } from "@/lib/services/showcase/state";
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

const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

function refusalText(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const text = raw.replace(CONTROL_CHARS, " ").trim().slice(0, 200);
  return text.length > 0 ? text : null;
}

export default async function MemberShowcasePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const resolver = await resolveScopedSelfScope("member");
  if (!resolver) notFound();

  let state;
  try {
    state = await resolver.read((tx, scope) => readShowcaseState(tx, scope));
  } catch (cause) {
    if (cause instanceof NotFoundError) notFound();
    throw cause;
  }
  const subject = state.subjects[0];
  if (!subject) notFound();

  const refused = refusalText(query.refused);
  const isMinor = subject.isMinor === true;
  const needsName = !subject.chosenName;
  const canPublish = subject.allowedActions.includes("approve");
  const canTakeDown = subject.allowedActions.includes("revoke");
  const canObject = subject.allowedActions.includes("no");
  const canPermit = subject.allowedActions.includes("permit");
  const objectStanding = subject.lastSubjectAction === "no";

  return (
    <main className="mx-auto w-full max-w-xl px-4 py-8">
      <BackLink href="/member" label="Member home" />
      <h1 className="font-display text-[22px] font-semibold text-marine">
        Your achievements page
      </h1>
      <p className="mt-1 text-[13px] text-ink-3">
        A public page with the skills your coaches recorded, under a name you
        choose. You can change your mind at any time.
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
            <CardTitle>Where your page stands</CardTitle>
            <CardDescription>{subject.reason}</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {subject.chosenName ? (
            <p className="text-[13px] text-ink-2">
              Your page shows the name{" "}
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

          {canPublish && !subject.publicPath ? (
            <form
              method="post"
              action="/api/self/showcase"
              className="mt-4 flex flex-col gap-3"
            >
              <input type="hidden" name="action" value="approve" />
              {needsName ? (
                <>
                  <Label htmlFor="chosenName" required>
                    The name your page will show
                  </Label>
                  <Input
                    id="chosenName"
                    name="chosenName"
                    maxLength={60}
                    placeholder="A name you are happy to be known by"
                    required
                  />
                  <p className="text-[12px] text-ink-3">
                    This is the only name that appears. Your legal name is
                    never published.
                  </p>
                </>
              ) : null}
              <Button type="submit" variant="primary">
                Publish my page
              </Button>
            </form>
          ) : null}

          {canTakeDown && subject.publicPath ? (
            <form
              method="post"
              action="/api/self/showcase"
              className="mt-4"
            >
              <input type="hidden" name="action" value="revoke" />
              <Button type="submit" variant="destructive">
                Take my page down
              </Button>
            </form>
          ) : null}

          {isMinor ? (
            <div className="mt-4 flex flex-col gap-3">
              <p className="text-[13px] text-ink-2">
                {objectStanding
                  ? "You asked the club not to publish you. Your linked guardians' approval has not been changed."
                  : "A linked guardian approves the publication. You can ask the club not to publish you, or you can allow it."}
              </p>
              {canObject && !objectStanding ? (
                <form method="post" action="/api/self/showcase">
                  <input type="hidden" name="action" value="no" />
                  <Button type="submit" variant="secondary">
                    Ask the club not to publish me
                  </Button>
                </form>
              ) : null}
              {canPermit && objectStanding ? (
                <form method="post" action="/api/self/showcase">
                  <input type="hidden" name="action" value="permit" />
                  <Button type="submit" variant="primary">
                    Allow my page to be published
                  </Button>
                </form>
              ) : null}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
