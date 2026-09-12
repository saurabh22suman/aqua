import { previewLoginLink } from "@/lib/services/invite-link";
import { LoginLinkRedeemForm } from "@/components/login-link-redeem-form";
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
      <main className="px-5 pt-10">
        <h1 className="font-display text-[19px] font-semibold">Link expired or invalid</h1>
        <p className="mt-2 text-[14px] text-ink-2">
          This login link doesn&apos;t work — it may have expired or already been used.
          Ask your club for a fresh one.
        </p>
      </main>
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
