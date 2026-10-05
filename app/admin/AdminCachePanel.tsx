"use client";

import { useEffect, useState } from "react";

type CacheStatus = {
  activeBuildId: string | null;
  releaseCopies: number;
  runtimeCopies: number;
  protectedCopies: number;
};

const emptyStatus: CacheStatus = {
  activeBuildId: null,
  releaseCopies: 0,
  runtimeCopies: 0,
  protectedCopies: 0,
};

async function rebuildBrowserShell() {
  if (!("caches" in window)) return;
  const keys = await window.caches.keys();
  await Promise.all(keys.map((key) => window.caches.delete(key)));

  if (!("serviceWorker" in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration();
  await registration?.update().catch(() => undefined);
  const activeWorker = registration?.active ?? navigator.serviceWorker.controller;
  activeWorker?.postMessage({ type: "REBUILD_SHELL_CACHE" });
}

export function AdminCachePanel() {
  const [status, setStatus] = useState<CacheStatus>(emptyStatus);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/admin/cache", { cache: "no-store" })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Не удалось получить состояние кэша.");
        setStatus(result.status ?? emptyStatus);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Ошибка."));
  }, []);

  const clearCache = async () => {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/admin/cache", { method: "POST" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? "Не удалось очистить кэш.");
      await rebuildBrowserShell();
      setStatus(result.status ?? emptyStatus);
      setMessage(result.message ?? "Кэш обновлён.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Ошибка.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="cache-maintenance">
      <div>
        <span className="application-status">БЕЗОПАСНАЯ ОЧИСТКА</span>
        <h3>КЭШ САЙТА</h3>
        <p>
          Обновляет страницы на сервере и очищает старые файлы сайта в браузере.
          Аккаунты, анкеты, публикации, лаунчеры и резервные сборки не удаляются.
        </p>
      </div>
      <div className="cache-maintenance-status" aria-label="Состояние сборок сайта">
        <span><b>{status.releaseCopies}</b> РЕЛИЗОВ</span>
        <span><b>{status.runtimeCopies}</b> СБОРОК ЗАПУСКА</span>
        <span><b>{status.protectedCopies}</b> ЗАЩИЩЁННЫХ КОПИЙ</span>
        {status.activeBuildId ? <small>ТЕКУЩАЯ СБОРКА: {status.activeBuildId.slice(0, 12)}</small> : null}
      </div>
      <div className="cache-maintenance-actions">
        <button type="button" disabled={busy} onClick={() => void clearCache()}>
          {busy ? "ОБНОВЛЯЕМ…" : "ОЧИСТИТЬ КЭШ САЙТА"}
        </button>
        <small>Резервные копии остаются на сервере для быстрого отката.</small>
      </div>
      {message ? <p className="form-message success-message">{message}</p> : null}
      {error ? <p className="form-message error-message">{error}</p> : null}
    </article>
  );
}
