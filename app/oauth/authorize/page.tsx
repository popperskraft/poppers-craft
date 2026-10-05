import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MinecraftIcon } from "@/app/MinecraftIcon";
import { checkAuthorizeRequest, redirectHost } from "@/lib/ai-connect/authorize";
import { AI_CONNECT_CLOSED_MESSAGE, SCOPE_DESCRIPTIONS, canUseAiConnect } from "@/lib/ai-connect/config";
import { getCommunityViewer } from "@/lib/community";
import { loginPageUrl } from "@/lib/login-return";
import { getViewerIdentity } from "@/lib/waitlist";
import { AiConsent } from "./AiConsent";
import "@/app/ai-connect.css";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Подключение нейросети — PoppersCraft",
  robots: { index: false, follow: false },
};

function Notice({ title, text }: { title: string; text: string }) {
  return (
    <main className="ai-consent-page">
      <section className="paint-window ai-consent-window">
        <div className="window-bar"><span className="window-title-with-icon"><MinecraftIcon name="redstone" size="sm" /> connect_ai.exe</span></div>
        <div className="ai-consent-body">
          <h1>{title}</h1>
          <p>{text}</p>
        </div>
      </section>
    </main>
  );
}

/* Экран разрешения: нейросеть просит доступ к аккаунту, игрок решает.
   Вход и код 2FA — обычные, сайта; пароль нейросеть не видит. */
export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const params = Object.fromEntries(Object.entries(raw).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value]));
  const check = await checkAuthorizeRequest(params);
  if (check.kind === "fatal") return <Notice title="ДОСТУП НЕ ВЫДАН" text={check.message} />;
  if (check.kind === "redirect") redirect(check.url);

  const query = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  const current = `/oauth/authorize?${query.toString()}`;
  const identity = await getViewerIdentity();
  if (!identity) redirect(loginPageUrl(current));
  if (identity.needsMfa) redirect(`/mfa?next=${encodeURIComponent(current)}`);
  const viewer = await getCommunityViewer({ identity });
  if (!viewer) return <Notice title="ТОЛЬКО ДЛЯ ИГРОКОВ" text="Подключать нейросеть могут игроки с одобренной анкетой." />;
  if (!canUseAiConnect(viewer.user.id)) return <Notice title="ДОСТУП НЕ ВЫДАН" text={AI_CONNECT_CLOSED_MESSAGE} />;

  const { request, client } = check;
  const target = redirectHost(request.redirectUri);
  return (
    <AiConsent
      clientName={client.name}
      host={target.host}
      knownHost={target.known}
      login={viewer.profile.login}
      scopes={request.scopes.map((scope) => ({ id: scope, text: SCOPE_DESCRIPTIONS[scope] ?? scope }))}
      request={{
        client_id: request.clientId,
        redirect_uri: request.redirectUri,
        code_challenge: request.codeChallenge,
        state: request.state,
        scope: request.scopes.join(" "),
        resource: request.resource ?? "",
      }}
    />
  );
}
