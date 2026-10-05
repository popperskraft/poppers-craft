"use client";

import { useCallback, useEffect, useState } from "react";
import "@/app/ai-connect.css";

type Connection = { clientId: string; name: string; connectedAt: string; lastUsedAt: string | null };
type Activity = { id: number; clientName: string; summary: string; createdAt: string };

const when = (value: string) => new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(value));

/* Настройки профиля → «Нейросети»: как подключить ChatGPT или Claude,
   кто подключён и что нейросети сделали от имени игрока. */
export function AiConnectionsPanel() {
  const [mcpUrl, setMcpUrl] = useState("https://popperscraft.org/mcp");
  const [connections, setConnections] = useState<Connection[] | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/ai/connections", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMcpUrl(result.mcpUrl);
      setConnections(result.connections);
      setActivity(result.activity);
    } catch {
      setConnections([]);
      setMessage("Не удалось загрузить подключения. Обновите страницу.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(mcpUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setMessage("Не скопировалось — выделите адрес и скопируйте вручную.");
    }
  }

  async function disconnect(clientId: string) {
    setBusy(clientId);
    setMessage("");
    const response = await fetch("/api/ai/connections", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId }) });
    const result = await response.json().catch(() => ({}));
    setMessage(result.message ?? result.error ?? "");
    setBusy("");
    await load();
  }

  return (
    <div className="ai-panel">
      <p>Подключите ChatGPT или Claude к своему аккаунту — и попросите нейросеть написать пост, найти игрока, подсказать по Wiki или перекрасить скин.</p>

      <div className="ai-panel-url">
        <small>АДРЕС ДЛЯ ПОДКЛЮЧЕНИЯ</small>
        <code translate="no">{mcpUrl}</code>
        <button type="button" onClick={copy}>{copied ? "СКОПИРОВАНО ✓" : "СКОПИРОВАТЬ"}</button>
      </div>

      <div className="ai-panel-steps">
        <section>
          <h3>CLAUDE</h3>
          <ol>
            <li>Откройте настройки Claude → «Коннекторы» и нажмите «Добавить свой коннектор».</li>
            <li>Вставьте адрес выше и нажмите «Подключить».</li>
            <li>Откроется PoppersCraft: войдите и нажмите «Разрешить».</li>
          </ol>
        </section>
        <section>
          <h3>CHATGPT</h3>
          <ol>
            <li>{"Откройте настройки ChatGPT → «Приложения» (Apps & Connectors) и добавьте своё приложение. Для этого может понадобиться включить режим разработчика в разделе «Дополнительно»."}</li>
            <li>Вставьте адрес выше, способ входа — OAuth.</li>
            <li>Откроется PoppersCraft: войдите и нажмите «Разрешить».</li>
          </ol>
        </section>
      </div>
      <p className="ai-panel-note">Названия пунктов в ChatGPT и Claude могут немного отличаться и зависят от тарифа. Нейросеть не получает пароль, почту, 2FA, оплату и управление аккаунтом. Перед публикацией и изменениями она показывает, что собирается сделать.</p>

      <h3>ПОДКЛЮЧЕНО</h3>
      {connections === null ? <p>Загружаем…</p> : connections.length ? (
        <ul className="ai-panel-connections">
          {connections.map((connection) => (
            <li key={connection.clientId}>
              <div><b translate="no">{connection.name}</b><small>{`подключено ${when(connection.connectedAt)}${connection.lastUsedAt ? ` · последний раз ${when(connection.lastUsedAt)}` : ""}`}</small></div>
              <button type="button" disabled={busy === connection.clientId} onClick={() => disconnect(connection.clientId)}>{busy === connection.clientId ? "ОТКЛЮЧАЕМ…" : "ОТКЛЮЧИТЬ"}</button>
            </li>
          ))}
        </ul>
      ) : <p>Пока ни одна нейросеть не подключена.</p>}

      {activity.length ? (
        <>
          <h3>ЧТО НЕЙРОСЕТИ СДЕЛАЛИ</h3>
          <ul className="ai-panel-activity">
            {activity.map((entry) => <li key={entry.id}><time>{when(entry.createdAt)}</time> <b translate="no">{entry.clientName}</b>: {entry.summary}</li>)}
          </ul>
        </>
      ) : null}
      {message ? <p className="form-message" role="status">{message}</p> : null}
    </div>
  );
}
