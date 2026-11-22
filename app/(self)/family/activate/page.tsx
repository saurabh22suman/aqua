import { LoginWelcome } from "@/components/auth/login-welcome";
import { SelfInvitationForm } from "@/components/self-invitation-form";

// THE FAMILY INVITATION.
//
// The club's invitation link for a guardian carries its code in the URL
// FRAGMENT (#token=...). The fragment is read in the BROWSER, never in
// this server render, never in a query string, never in a request path
// and never in a log. A fragment is not sent to the server at all, so
// the code reaches the server only in the activation request's body.
//
// This page holds no credential and reads no record: it is a form. The
// account behind the code is the door's business, not the page's.
//
// There is no reset flow, no message code and no "verified" claim.

export default function FamilyActivatePage() {
  return (
    <LoginWelcome>
      <SelfInvitationForm audience="guardian" />
    </LoginWelcome>
  );
}
