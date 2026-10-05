import { redirect } from "next/navigation";
import { MinecraftIcon } from "@/app/MinecraftIcon";
import { getViewerIdentity } from "@/lib/waitlist";
import { MfaChallenge } from "./MfaChallenge";
import { safeRelativeRedirect } from "@/lib/safe-redirect";
import { WindowCloseLink } from "@/app/WindowCloseLink";
import { BackButton } from "@/app/BackButton";

export const dynamic = "force-dynamic";

export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const viewer = await getViewerIdentity();
  if (!viewer) redirect("/");
  const params = await searchParams;
  const target = safeRelativeRedirect(params.next, "/profile");
  /* Возврат на саму проверку привёл бы к бесконечному кругу. */
  const next = target.startsWith("/mfa") ? "/profile" : target;
  /* Код уже подтверждён — окно проверки больше не показывается. */
  if (!viewer.needsMfa) redirect(next);
  return (
    <main className="profile-page">
      <div className="paint-window profile-window mfa-window">
        <div className="window-bar">
          <span className="window-title-with-icon"><MinecraftIcon name="key" size="sm" /> two_factor_auth.exe</span>
          <BackButton />
          <div className="window-actions"><WindowCloseLink label="Закрыть проверку и вернуться на главную" /></div>
        </div>
        <div className="profile-content"><MfaChallenge next={next} /></div>
      </div>
    </main>
  );
}
