"use client";

import { useEffect, useState } from "react";
import { MinecraftIcon } from "./MinecraftIcon";

const SESSION_KEY = "popperscraft-update-toast-2026-08-02";

export function PlatformUpdateToast() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (window.sessionStorage.getItem(SESSION_KEY)) return;
    window.sessionStorage.setItem(SESSION_KEY, "shown");
    const showTimer = window.setTimeout(() => setVisible(true), 0);
    const hideTimer = window.setTimeout(() => setVisible(false), 9000);
    return () => {
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
    };
  }, []);

  if (!visible) return null;

  return (
    <aside className="platform-update-toast" role="status" aria-live="polite">
      <MinecraftIcon name="grass" size="sm" />
      <div><strong>САЙТ ОБНОВИЛСЯ</strong><span>Исправили мобильную версию и несколько ошибок.</span></div>
      <button type="button" aria-label="Закрыть сообщение" onClick={() => setVisible(false)}>×</button>
    </aside>
  );
}
