"use client";

import { parentPage, takePreviousPage, withHomeSection } from "@/lib/navigation-trail";

/* «← НАЗАД»: на предыдущую страницу пути, а если его нет — на
   родительскую. Итог оплаты, проверка 2FA, ссылки из писем и редакторы
   целью не бывают (lib/navigation-trail.ts).

   Раньше при пустом пути кнопка шла по document.referrer, и две страницы
   отправляли друг к другу по кругу. Теперь без пути — только родитель. */
export function BackButton({
  fallback,
  className = "",
  label = "← НАЗАД",
}: {
  fallback?: string;
  className?: string;
  label?: string;
}) {
  const goBack = () => {
    const { pathname, search } = window.location;
    const previous = takePreviousPage(pathname, search);
    window.location.assign(previous ? withHomeSection(previous) : fallback ?? parentPage(pathname, search));
  };

  return (
    <button
      type="button"
      className={`history-back-button ${className}`.trim()}
      onClick={goBack}
      aria-label="Вернуться на предыдущую страницу"
    >
      {label}
    </button>
  );
}
