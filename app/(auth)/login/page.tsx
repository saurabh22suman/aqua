import { AuthShell } from "@/components/auth/auth-shell";
import { ClubEditorialPanel } from "@/components/auth/club-editorial-panel";
import { LoginForm } from "@/components/login-form";

// The tenant entry.
//
// The page composes the frame; the form owns the task. The editorial
// panel is a separate slot in the shell so the phone keeps the form as
// the very first thing on screen — the panel is hidden below `lg` and
// the brand moves into the form column there instead.
export default function LoginPage() {
  return (
    <AuthShell panel={<ClubEditorialPanel />}>
      <LoginForm />
    </AuthShell>
  );
}
