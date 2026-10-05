"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { resetTrail } from "@/lib/navigation-trail";

/* Меню аккаунта в шапке: зелёная «ПРОФИЛЬ» ведёт в окно профиля, под ней —
   только «ВЫЙТИ» той же ширины (r100, просьба владельца: розовой «Профиль»
   больше нет, «Список игроков» — пункт шапки после «Ленты»). Настройки и
   подписка — вкладки окна профиля (app/profile/page.tsx).

   На компьютере «ВЫЙТИ» появляется при наведении, а клик по «ПРОФИЛЬ»
   открывает профиль. На телефоне наведения нет: первое касание показывает
   «ВЫЙТИ», второе — открывает профиль. */
export function ProfileMenu({ approved = true, needsMfa = false }: { approved?: boolean; needsMfa?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  async function logout() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch("/api/logout", { method: "POST" });
    } finally {
      /* Страницы аккаунта после выхода закрыты — «Назад» туда не ведёт. */
      resetTrail();
      window.location.assign("/");
    }
  }

  const openOnTouch = (event: MouseEvent<HTMLElement>) => {
    if (!window.matchMedia("(hover: none)").matches || open) return;
    event.preventDefault();
    setOpen(true);
  };

  /* Карточка и настройки есть только у одобренной анкеты (и у
     администраторов). Не подтвердившему код 2FA — сначала проверка. */
  const hasProfile = approved && !needsMfa;
  return (
    <div ref={root} className={open ? "header-profile-menu is-open" : "header-profile-menu"}>
      {hasProfile || needsMfa ? (
        <Link
          className="header-login-button"
          href={needsMfa ? "/mfa" : "/profile"}
          onClick={openOnTouch}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          ПРОФИЛЬ ▾
        </Link>
      ) : (
        <button className="header-login-button" type="button" onClick={() => setOpen((value) => !value)} aria-haspopup="menu" aria-expanded={open}>
          АККАУНТ ▾
        </button>
      )}
      <div className="header-profile-dropdown">
        {needsMfa ? <Link className="header-profile-item" href="/mfa">ПОДТВЕРДИТЬ ВХОД</Link> : null}
        <button type="button" className="header-login-button header-profile-logout" disabled={busy} onClick={logout}>
          {busy ? "ВЫХОДИМ…" : "ВЫЙТИ"}
        </button>
      </div>
    </div>
  );
}
