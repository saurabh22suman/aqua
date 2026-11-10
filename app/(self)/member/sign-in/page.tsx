import { LoginWelcome } from "@/components/auth/login-welcome";
import { SelfSignInForm } from "@/components/self-access-form";

// THE MEMBER SIGN-IN.
//
// An existing account signs in with the mobile number and the PIN the
// club holds. There is NO pre-PIN lookup, no club search, no person
// search and no discovery API: the form asks for two things and the
// door answers.
//
// `?clubId=` is an OPTIONAL club selector for an account linked in more
// than one club. It is the club's TENANT id, and it goes ONLY into the
// sign-in request's clubId field. It is NEVER a club slug, and it is
// never handed to the scope resolver, which compares slugs.
//
// This page NEVER redirects because of a staff session. A club staff
// member who opens the member sign-in sees the member form; switching
// audiences goes to the other sign-in view, not to a hidden staff
// credential.
//
// The club selector is accepted only when it is a uuid; anything else is
// dropped rather than forwarded.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function MemberSignInPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const raw = typeof params.clubId === "string" ? params.clubId : "";
  const clubId = UUID_RE.test(raw) ? raw : undefined;
  return (
    <LoginWelcome>
      <SelfSignInForm audience="member" clubId={clubId} />
    </LoginWelcome>
  );
}
