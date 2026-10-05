"use client";

import { useState } from "react";
import { MinecraftIcon } from "@/app/MinecraftIcon";

type ConsentRequest = { client_id: string; redirect_uri: string; code_challenge: string; state: string; scope: string; resource: string };

/* Решение уходит запросом, а переход к нейросети — через
   location.assign: правило form-action 'self' в CSP не пустило бы
   форму перенаправить человека на claude.ai или chatgpt.com. */
export function AiConsent({ clientName, host, knownHost, login, scopes, request }: {
  clientName: string;
  host: string;
  knownHost: boolean;
  login: string;
  scopes: Array<{ id: string; text: string }>;
  request: ConsentRequest;
}) {
  const [busy, setBusy] = useState<"allow" | "deny" | null>(null);
  const [error, setError] = useState("");

  async function decide(decision: "allow" | "deny") {
    if (busy) return;
    setBusy(decision);
    setError("");
    try {
      const response = await fetch("/api/ai/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...request, decision }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || typeof result.redirect !== "string") throw new Error(result.error ?? "Не получилось. Попробуйте ещё раз.");
      window.location.assign(result.redirect);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не получилось. Попробуйте ещё раз.");
      setBusy(null);
    }
  }

  return (
    <main className="ai-consent-page">
      <section className="paint-window ai-consent-window">
        <div className="window-bar"><span className="window-title-with-icon"><MinecraftIcon name="redstone" size="sm" /> connect_ai.exe</span></div>
        <div className="ai-consent-body">
          <p className="ai-consent-kicker">ПОДКЛЮЧЕНИЕ НЕЙРОСЕТИ</p>
          <h1><span translate="no">{clientName}</span> просит доступ к аккаунту @<span translate="no">{login}</span></h1>
          <p>После разрешения вы вернётесь на <b translate="no">{host}</b>, и нейросеть сможет действовать на PoppersCraft от вашего имени:</p>
          <ul className="ai-consent-scopes">
            {scopes.map((scope) => <li key={scope.id}>{scope.text}</li>)}
          </ul>
          <p className="ai-consent-never">Почта, пароль, 2FA, оплата, управление и удаление аккаунта ей недоступны. Каждое действие видно в настройках профиля, в разделе «Нейросети». Там же подключение можно отключить.</p>
          {!knownHost ? <p className="ai-consent-warning">Это не ChatGPT и не Claude. Разрешайте, только если подключение начали вы сами.</p> : null}
          {error ? <p className="form-message error-message" role="alert">{error}</p> : null}
          <div className="ai-consent-actions">
            <button type="button" className="ai-consent-allow" disabled={Boolean(busy)} onClick={() => decide("allow")}>{busy === "allow" ? "ПОДКЛЮЧАЕМ…" : "РАЗРЕШИТЬ"}</button>
            <button type="button" className="ai-consent-deny" disabled={Boolean(busy)} onClick={() => decide("deny")}>{busy === "deny" ? "ОТКАЗЫВАЕМ…" : "ОТКАЗАТЬ"}</button>
          </div>
        </div>
      </section>
    </main>
  );
}
