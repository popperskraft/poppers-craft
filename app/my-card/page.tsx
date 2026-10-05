import { redirect } from "next/navigation";
import { loginPageUrl } from "@/lib/login-return";
import { getCommunityViewer } from "@/lib/community";
import { getViewerIdentity } from "@/lib/waitlist";

export const dynamic = "force-dynamic";

export default async function MyCardPage() {
  const identity = await getViewerIdentity();
  if (!identity) redirect(loginPageUrl("/my-card"));
  if (identity.needsMfa) redirect("/mfa?next=/my-card");

  const viewer = await getCommunityViewer({ identity, allowAuthenticated: true });
  /* Вход есть, но профиль сообщества не открылся — окно входа тут не поможет. */
  if (!viewer) redirect("/");

  redirect("/players/" + encodeURIComponent(viewer.profile.login));
}
