"use client";

import { useEffect, useState } from "react";

export function SiteCrashGuard({ initialActive }: { initialActive: boolean }) {
  const [active, setActive] = useState(initialActive);

  useEffect(() => {
    document.body.classList.toggle("site-crash-mode", active);
    return () => document.body.classList.remove("site-crash-mode");
  }, [active]);

  useEffect(() => {
    let stopped = false;

    const refresh = async () => {
      try {
        const response = await fetch("/api/site-state", { cache: "no-store" });
        if (!response.ok) return;
        const result = await response.json();
        if (stopped) return;
        setActive(Boolean(result.crashMode));
        /* Тот же ответ нужен окну отсчёта до открытия — без второго опроса. */
        window.dispatchEvent(new CustomEvent("popperscraft:site-state", { detail: result }));
      } catch {
        // Keep the last known state if the status request is temporarily unavailable.
      }
    };

    const timer = window.setInterval(refresh, 10_000);
    window.addEventListener("focus", refresh);
    void refresh();

    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  if (!active) return null;

  return (
    <div className="crash-mode-layer" aria-hidden="true">
      <div className="crash-mode-ticker">FATAL_ERROR.EXE · CSS НЕ НАЙДЕН · САЙТ СЛОМАН · НЕ НАЖИМАТЬ · </div>
      <div className="crash-mode-dialog crash-dialog-one">
        <b>ОШИБКА 0xPOPPERS</b>
        <span>Интерфейс перестал быть интерфейсом.</span>
      </div>
      <div className="crash-mode-dialog crash-dialog-two">
        <b>WINDOWS PAINT УСТАЛ</b>
        <span>Кнопки больше ничего не обещают.</span>
      </div>
      <div className="crash-mode-dialog crash-dialog-three">
        <b>CTRL + Z НЕ ПОМОЖЕТ</b>
        <span>Попробуйте вернуться потом.</span>
      </div>
      <span className="crash-mode-code">▓▒░ 503 503 503 ░▒▓</span>
    </div>
  );
}
