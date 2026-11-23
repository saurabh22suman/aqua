import { notFound } from "next/navigation";
import { resolveScopedSelfScope } from "@/lib/auth/self-scope";
import { NotFoundError } from "@/lib/auth/context";
import {
  readShowcaseState,
  type ShowcaseState,
} from "@/lib/services/showcase/state";
import { Button, buttonClasses } from "@/components/ui/Button";
import { BackLink } from "@/components/ui/BackLink";
import { StatusBadge, type StatusTone } from "@/components/ui/StatusBadge";
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

function PublicationUnavailable() {
  return (
    <section
      aria-labelledby="publication-unavailable"
      className="mt-4 rounded-card border border-line bg-paper p-4"
    >
      <h2
        id="publication-unavailable"
        className="text-[16px] font-semibold text-ink"
      >
        Achievements page unavailable
      </h2>
      <p role="alert" className="mt-2 text-[13px] leading-relaxed text-ink-2">
        Could not load your achievements page. Nothing was published or
        changed.
      </p>
      <a
        href="/member/showcase"
        className={buttonClasses({
          variant: "secondary",
          size: "sm",
          className: "mt-3",
        })}
      >
        Retry achievements page
      </a>
    </section>
  );
}

// The member's own achievements-page surface. It uses the same
// publication vocabulary and primitives as the family page (status,
// public name, approval and privacy choice) so a member and a guardian
// read one model. The family page keeps its own guarded child scope.
export default async function MemberShowcasePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const resolver = await resolveScopedSelfScope("member");
  if (!resolver) notFound();

  let state: ShowcaseState | null = null;
  try {
    state = await resolver.read((tx, scope) => readShowcaseState(tx, scope));
  } catch (cause) {
    if (cause instanceof NotFoundError) notFound();
  }

  const refused = refusalText(query.refused);

  if (!state) {
    return (
      <main className="mx-auto w-full max-w-xl px-4 pb-8 pt-4">
        <BackLink href="/member" label="Member home" />
        <header>
          <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">
            Achievements page
          </h1>
          <p className="mt-2 max-w-[56ch] text-[13px] leading-relaxed text-ink-2">
            A public page with the skills your coaches recorded, under a name
            you choose. You can take the page down if you change your mind.
          </p>
        </header>
        {refused ? (
          <p
            role="status"
            className="mt-4 rounded-ctl border border-line bg-paper px-4 py-3 text-[13px] text-ink-2"
          >
            {refused}
          </p>
        ) : null}
        <PublicationUnavailable />
      </main>
    );
  }

  const subject = state.subjects[0];
  if (!subject) notFound();

  const isMinor = subject.isMinor === true;
  const needsName = !subject.chosenName;
  const canPublish = subject.allowedActions.includes("approve");
  const canTakeDown = subject.allowedActions.includes("revoke");
  const canObject = subject.allowedActions.includes("no");
  const canPermit = subject.allowedActions.includes("permit");
  const objectStanding = subject.lastSubjectAction === "no";
  const isPublic = Boolean(subject.publicPath);
  const statusLabel = isPublic
    ? "Public"
    : subject.state === "pending"
      ? "Not public yet"
      : "Private";
  const statusTone: StatusTone = isPublic
    ? "good"
    : subject.state === "pending"
      ? "warn"
      : "neutral";

  return (
    <main className="mx-auto w-full max-w-xl px-4 pb-8 pt-4">
      <BackLink href="/member" label="Member home" />
      <header>
        <h1 className="text-[26px] font-semibold leading-tight tracking-tight text-ink">
          Achievements page
        </h1>
        <p className="mt-2 max-w-[56ch] text-[13px] leading-relaxed text-ink-2">
          A public page with the skills your coaches recorded, under a name you
          choose. You can take the page down if you change your mind.
        </p>
      </header>

      {refused ? (
        <p
          role="status"
          className="mt-4 rounded-ctl border border-line bg-paper px-4 py-3 text-[13px] text-ink-2"
        >
          {refused}
        </p>
      ) : null}

      <section
        aria-labelledby="publication-status"
        className="mt-4 rounded-card border border-line bg-paper p-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2
            id="publication-status"
            className="text-[16px] font-semibold text-ink"
          >
            Publication status
          </h2>
          <StatusBadge tone={statusTone}>{statusLabel}</StatusBadge>
        </div>
        <p className="mt-2 text-[13px] text-ink-2">{subject.reason}</p>
        {subject.chosenName ? (
          <p className="mt-2 text-[13px] text-ink-2">
            Public name{" "}
            <strong className="break-words text-ink">
              {subject.chosenName}
            </strong>
          </p>
        ) : null}
        {subject.publicPath ? (
          <a
            href={subject.publicPath}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-flex min-h-11 items-center font-medium text-water underline"
          >
            View public page
          </a>
        ) : null}
      </section>

      {canPublish && !isPublic ? (
        <section
          aria-labelledby="public-approval"
          className="mt-3 rounded-card border border-line bg-paper p-4"
        >
          <h2
            id="public-approval"
            className="text-[16px] font-semibold text-ink"
          >
            Public name and approval
          </h2>
          <form
            method="post"
            action="/api/self/showcase"
            className="mt-2 space-y-3"
          >
            <input type="hidden" name="action" value="approve" />
            {needsName ? (
              <div className="space-y-2">
                <p
                  id="public-name-help"
                  className="text-[13px] leading-relaxed text-ink-2"
                >
                  Check the spelling before publishing. The public name cannot
                  be changed after it is set, even if you take the page down.
                  Only the chosen name appears on the public page; your legal
                  name is never published. If you need help with the name,
                  contact your club — changing it is not available in this
                  release.
                </p>
                <Label htmlFor="chosenName" required>
                  The name your page will show
                </Label>
                <Input
                  id="chosenName"
                  name="chosenName"
                  maxLength={60}
                  placeholder="A name you are happy to be known by"
                  required
                  aria-describedby="public-name-help"
                />
              </div>
            ) : null}
            <p className="text-[12px] leading-relaxed text-ink-2">
              Publishing makes the chosen name and the skills your coaches
              recorded visible on a public page.
            </p>
            <Button type="submit" variant="primary">
              Publish my page
            </Button>
          </form>
        </section>
      ) : null}

      {canTakeDown && isPublic ? (
        <section
          aria-labelledby="privacy-choice"
          className="mt-3 rounded-card border border-line bg-paper p-4"
        >
          <h2 id="privacy-choice" className="text-[16px] font-semibold text-ink">
            Privacy choice
          </h2>
          <form method="post" action="/api/self/showcase" className="mt-2">
            <input type="hidden" name="action" value="revoke" />
            <p className="mb-2 text-[13px] leading-relaxed text-ink-2">
              Taking the page down hides it immediately. You can publish it
              again later with the same public name.
            </p>
            <Button type="submit" variant="destructive">
              Take my page down
            </Button>
          </form>
        </section>
      ) : null}

      {isMinor ? (
        <section
          aria-labelledby="your-choice"
          className="mt-3 rounded-card border border-line bg-paper p-4"
        >
          <h2 id="your-choice" className="text-[16px] font-semibold text-ink">
            Your choice
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
            {objectStanding
              ? "You asked the club not to publish you. Your linked guardians' approval has not been changed."
              : "A linked guardian approves the publication. You can ask the club not to publish you, or you can allow it."}
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {canObject && !objectStanding ? (
              <form method="post" action="/api/self/showcase">
                <input type="hidden" name="action" value="no" />
                <Button type="submit" variant="secondary" className="w-full">
                  Ask the club not to publish me
                </Button>
              </form>
            ) : null}
            {canPermit && objectStanding ? (
              <form method="post" action="/api/self/showcase">
                <input type="hidden" name="action" value="permit" />
                <Button type="submit" variant="primary" className="w-full">
                  Allow my page to be published
                </Button>
              </form>
            ) : null}
          </div>
        </section>
      ) : null}
    </main>
  );
}
