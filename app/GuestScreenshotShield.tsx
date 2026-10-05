"use client";

import { useEffect, useState } from "react";

/* Затемнение содержимого при попытке снять скриншот — только для гостей.

   ЧЕСТНО О ВОЗМОЖНОСТЯХ. Это не защита, а помеха. Браузер не может запретить
   снимок экрана: экраном распоряжается операционная система. Комбинацию мы
   ловим только потому, что браузер получает нажатие клавиш раньше, чем
   система делает снимок, и это гонка, которую мы не всегда выигрываем.

   Не остановит: съёмку экрана на камеру другого телефона, запись видео,
   инструменты разработчика, отключённый JavaScript, curl и режим чтения.
   Единственная настоящая защита — не отдавать данные гостю вообще.

   Что ловим:
   - macOS: Cmd+Shift (снимки 3, 4, 5);
   - Windows: PrintScreen, Alt+PrintScreen, Win+PrintScreen, Win+Shift+S
     («Ножницы»), а также любое сочетание с клавишей Windows;
   - клавишу Print/Snapshot — так её называют некоторые раскладки.

   ВАЖНОЕ ОГРАНИЧЕНИЕ WINDOWS. Клавиша PrintScreen там перехватывается
   системой, и браузер получает только событие отпускания, без нажатия. То
   есть снимок уже сделан к моменту, когда мы о нём узнаём: закрыть экран
   заранее в этом случае невозможно. Маска всё равно включается — она скроет
   содержимое от повторного снимка, но первый кадр защитить нельзя.

   Сочетания с клавишей Windows работают лучше: система показывает наложение
   «Ножниц» не мгновенно, и нажатие самой клавиши Windows до нас доходит.
   Поэтому на Windows маска включается на любое сочетание с этой клавишей.

   Экран возвращается, как только отпущены клавиши. Дополнительно стоит
   предохранитель по времени: маска не может залипнуть дольше 4 секунд, даже
   если браузер не пришлёт keyup — так бывает, когда система перехватывает
   комбинацию себе. */

const MAX_MASK_MS = 4_000;

export function GuestScreenshotShield({ active }: { active: boolean }) {
  const [masked, setMasked] = useState(false);

  useEffect(() => {
    if (!active) return;

    let timer: number | undefined;

    const hide = () => {
      setMasked(true);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setMasked(false), MAX_MASK_MS);
    };

    const show = () => {
      window.clearTimeout(timer);
      setMasked(false);
    };

    /* На Apple клавиша Cmd используется в обычных сочетаниях (копировать,
       вставить, новая вкладка), поэтому там реагируем только на Cmd+Shift.
       На Windows клавиша Windows для действий внутри страницы не нужна, и
       любое сочетание с ней разумно считать попыткой снимка. */
    const isApple = /Mac|iPhone|iPad|iPod/i.test(
      (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform
      ?? navigator.platform
      ?? navigator.userAgent,
    );

    const isCaptureKey = (event: KeyboardEvent) =>
      event.key === "PrintScreen" || event.key === "Print" || event.key === "Snapshot";

    const onKeyDown = (event: KeyboardEvent) => {
      if (isCaptureKey(event)) {
        hide();
        return;
      }
      if (event.metaKey && event.shiftKey) {
        hide();
        return;
      }
      if (!isApple && (event.key === "Meta" || event.metaKey)) hide();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      /* На Windows это единственное событие, которое даёт PrintScreen. */
      if (isCaptureKey(event)) {
        hide();
        return;
      }
      /* Достаточно отпустить любую клавишу сочетания. */
      if (!event.metaKey || !event.shiftKey) show();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    /* Уход из вкладки снимает маску: иначе она залипнет, если система
       перехватила комбинацию и keyup до нас не дошёл. */
    window.addEventListener("blur", show);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", show);
    };
  }, [active]);

  if (!active || !masked) return null;

  return (
    <div className="screenshot-shield" role="presentation" aria-hidden="true">
      <p>СОДЕРЖИМОЕ СКРЫТО</p>
      <small>Войдите в аккаунт, чтобы пользоваться сайтом без ограничений</small>
    </div>
  );
}
