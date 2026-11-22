import { LoginWelcome } from "@/components/auth/login-welcome";
import { SelfSignInForm } from "@/components/self-access-form";

// THE FAMILY SIGN-IN.
//
// The guardian signs in with the mobile number and the PIN on the
// child's membership. It is the same door as the member sign-in with the
// guardian audience, and it is a separate VIEW: a family account that
// opens the member sign-in is told to use this one, and vice versa.
//
// `?clubId=` is an OPTIONAL club selector for an account linked in more
// than one club. It is the club's TENANT id, and it goes ONLY into the
// sign-in request's clubId field — never into a URL of its own, and
// never into the scope resolver, which compares slugs.
//
// This page NEVER redirects because of a staff session.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function FamilySignInPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const raw = typeof params.clubId === "string" ? params.clubId : "";
  const clubId = UUID_RE.test(raw) ? raw : undefined;
  return (
    <LoginWelcome>
      <SelfSignInForm audience="guardian" clubId={clubId} />
    </LoginWelcome>
  );
}
