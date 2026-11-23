import { previewLoginLink } from "@/lib/services/invite-link";
import { LoginLinkRedeemForm } from "@/components/login-link-redeem-form";
import { LoginWelcome } from "@/components/auth/login-welcome";
import { BackLink } from "@/components/ui/BackLink";
import { formatDateTimeIST } from "@/lib/time/tz";

// Public redeem page for staff magic-link login. Pre-auth by
// definition (the link IS the credential); previewLoginLink reads
// everything the confirm screen needs WITHOUT consuming the jti.
// Every failure kind renders the same generic page -- preview
// must not become an oracle for which links are live.
export default async function LoginLinkPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const preview = await previewLoginLink(token);

  if (preview.kind === "error") {
    return (
      <LoginWelcome>
        <h1 className="font-display text-[19px] font-semibold">Link expired or invalid</h1>
        <p className="mt-2 text-[14px] text-ink-2">
          Ask your club for a fresh link if you still need to set up access. If you already have a PIN, sign in with it below.
        </p>
        <div className="mt-4"><BackLink href="/login" label="Sign in" /></div>
      </LoginWelcome>
    );
  }

  return (
    <LoginLinkRedeemForm
      token={token}
      phone={preview.phone}
      roleKey={preview.roleKey}
      tenantName={preview.tenantName}
      expiresAt={formatDateTimeIST(preview.expiresAt)}
      credentialSet={preview.credentialSet}
      purpose={preview.purpose}
    />
  );
}
