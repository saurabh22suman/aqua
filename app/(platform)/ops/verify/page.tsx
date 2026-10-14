import { redirect } from "next/navigation";
import { platformAuthStatusAction } from "@/lib/actions/platform-auth";

export default async function PlatformVerifyPage() {
  const status = await platformAuthStatusAction();
  if (status.kind === "not_found" || status.kind === "expired") {
    redirect("/ops/login");
  }
  if (status.kind === "authenticated") redirect("/ops");
  redirect("/ops/login");
}
