"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { OpeningCountdown } from "./OpeningCountdown";

/* Страницы, которые работают и во время отсчёта: вход администраторов,
   подтверждение кода 2FA и возврат после входа. */
const OPEN_PATHS = /^\/(admin|mfa|auth)(\/|$)/;

/* Пока идёт отсчёт до открытия, вместо страницы показывается торжественное
   окно. Администраторам сервер передаёт openingAt = null, и они видят сайт
   как обычно.

   Состояние обновляется из того же опроса /api/site-state, что и
   краш-режим (событие popperscraft:site-state): запуск отсчёта закрывает
   сайт у открытых вкладок, остановка — открывает с церемонией.

   ?opening-preview=<время> показывает окно поверх сайта для предпросмотра
   из управления. Это только картинка: сайт при этом не закрывается. */
export function OpeningGate({
  openingAt,
  serverNow,
  children,
}: {
  openingAt: string | null;
  serverNow: number;
  children: ReactNode;
}) {
  const pathname = usePathname() ?? "/";
  const [target, setTarget] = useState(openingAt);
  const [openedEarly, setOpenedEarly] = useState(false);
  const [offset, setOffset] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const targetRef = useRef(openingAt);

  useEffect(() => {
    setOffset(serverNow - Date.now());
  }, [serverNow]);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("opening-preview");
    const time = value ? Date.parse(value) : NaN;
    if (Number.isFinite(time)) setPreview(new Date(time).toISOString());
  }, []);

  useEffect(() => {
    const onState = (event: Event) => {
      const detail = (event as CustomEvent<{ openingAt?: string | null; serverNow?: number }>).detail;
      if (typeof detail?.serverNow === "number") setOffset(detail.serverNow - Date.now());
      const next = typeof detail?.openingAt === "string" ? detail.openingAt : null;
      if (next) {
        targetRef.current = next;
        setTarget(next);
        setOpenedEarly(false);
      } else if (targetRef.current) {
        /* Отсчёт остановили досрочно — сайт открывается прямо сейчас. */
        setOpenedEarly(true);
      }
    };
    window.addEventListener("popperscraft:site-state", onState);
    return () => window.removeEventListener("popperscraft:site-state", onState);
  }, []);

  const exitPreview = useCallback(() => {
    const url = new URL(window.location.href);
    url.searchParams.delete("opening-preview");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    setPreview(null);
  }, []);

  if (preview) {
    return (
      <>
        {children}
        <OpeningCountdown opensAt={preview} offset={0} preview onExitPreview={exitPreview} />
      </>
    );
  }

  if (!target || OPEN_PATHS.test(pathname)) return <>{children}</>;
  return <OpeningCountdown opensAt={target} offset={offset} openedEarly={openedEarly} />;
}
