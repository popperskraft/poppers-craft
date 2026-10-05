"use client";

import { useEffect, useState } from "react";

/* Подсказка на телефоне: сайтом удобнее пользоваться с компьютера.
   Показывается при открытии сайта, но не чаще раза в COOLDOWN_MS — время
   последнего показа хранится в браузере. В приложении для iPhone не
   появляется: оно и сделано для телефона. */
const SEEN_KEY = "popperscraft-mobile-hint-shown-at";
const COOLDOWN_MS = 24 * 60 * 60 * 1000; // сутки
const SHOW_DELAY_MS = 1500;
const CONSENT_COOKIE = "popperscraft_cookie_consent=accepted";

function isPhone() {
  const touchOnly = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
  const smallScreen = Math.min(window.screen.width, window.screen.height) < 768;
  return touchOnly && smallScreen;
}

function shownRecently() {
  try {
    const last = Number(window.localStorage.getItem(SEEN_KEY) ?? 0);
    return Number.isFinite(last) && Date.now() - last < COOLDOWN_MS;
  } catch {
    return false;
  }
}

function markShown() {
  try {
    window.localStorage.setItem(SEEN_KEY, String(Date.now()));
  } catch {
    /* Без хранилища подсказка просто может показаться ещё раз. */
  }
}

export function MobileDesktopHint() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (document.documentElement.hasAttribute("data-pc-app")) return;
    if (!isPhone() || shownRecently()) return;

    let timer: number | undefined;
    let poll: number | undefined;
    /* Два окна разом раздражают: ждём, пока человек разберётся с cookie. */
    const start = () => {
      timer = window.setTimeout(() => {
        markShown();
        setOpen(true);
      }, SHOW_DELAY_MS);
    };
    if (document.cookie.includes(CONSENT_COOKIE)) {
      start();
    } else {
      poll = window.setInterval(() => {
        if (!document.cookie.includes(CONSENT_COOKIE)) return;
        window.clearInterval(poll);
        start();
      }, 1000);
    }
    return () => {
      window.clearTimeout(timer);
      window.clearInterval(poll);
    };
  }, []);

  if (!open) return null;

  return (
    <aside className="mobile-desktop-hint" role="status" aria-live="polite">
      <div className="mobile-desktop-hint-bar">
        <span>desktop_recommended.txt</span>
        <button type="button" aria-label="Закрыть подсказку" onClick={() => setOpen(false)}>×</button>
      </div>
      <div className="mobile-desktop-hint-body">
        <strong>С КОМПЬЮТЕРА УДОБНЕЕ</strong>
        <p>Сайт работает и на телефоне, но редактор моделей, лаунчер и часть разделов рассчитаны на большой экран. Для лучшего опыта заходите на popperscraft.org с компьютера.</p>
        <button type="button" onClick={() => setOpen(false)}>ПОНЯТНО</button>
      </div>
    </aside>
  );
}
