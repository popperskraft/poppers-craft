"use client";

import { type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { LauncherVideo, type LauncherVideoPlatform } from "./LauncherVideo";

/* Кнопки скачивания и видео-инструкция под ними. Сначала инструкции нет:
   она появляется, когда игрок нажал «Скачать» у macOS или Windows (любую
   версию), — для той системы, которую он выбрал, — и страница немного
   прокручивается к ней (решение владельца, 2026-10-02). Так ролик не
   грузится у тех, кто ничего не скачивает. Сама загрузка файла идёт как
   обычно: клик не перехватывается. */
export function LauncherDownloads({ children }: { children: ReactNode }) {
  const [platform, setPlatform] = useState<LauncherVideoPlatform | null>(null);
  const [reveal, setReveal] = useState(0);
  const guideRef = useRef<HTMLDivElement>(null);

  const onClick = (event: MouseEvent<HTMLElement>) => {
    const link = (event.target as HTMLElement).closest("a[href]");
    const chosen = link?.closest<HTMLElement>("[data-platform]")?.dataset.platform;
    if (chosen !== "macos" && chosen !== "windows") return;
    setPlatform(chosen);
    setReveal((value) => value + 1);
  };

  useEffect(() => {
    if (!reveal) return;
    const guide = guideRef.current;
    if (!guide) return;
    /* «Чуть-чуть»: верх инструкции встаёт на пятую часть экрана, если он
       ниже; если инструкция уже на виду, страница не двигается. */
    const shift = guide.getBoundingClientRect().top - window.innerHeight * 0.2;
    if (shift <= 0) return;
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    window.scrollBy({ top: shift, behavior: reduced ? "auto" : "smooth" });
  }, [reveal]);

  return (
    <>
      <section className="launcher-platforms" aria-label="Версии лаунчера" onClick={onClick}>
        {children}
      </section>
      <div ref={guideRef} className="launcher-video-slot">
        {platform ? <LauncherVideo key={platform} platform={platform} /> : null}
      </div>
    </>
  );
}
