"use client";

import { useEffect, useState } from "react";
import type { Locale } from "@/lib/i18n/config";

/* Названия языков всегда пишутся на своём языке и не переводятся
   (translate="no"): «Русский» должен оставаться «Русским» и в английской
   версии, иначе вернуться назад было бы трудно. */
export function LanguageSwitch({ current: initial, compact = false }: { current?: Locale; compact?: boolean }) {
  const [busy, setBusy] = useState<Locale | null>(null);
  const [error, setError] = useState("");
  /* На главной язык не передают сверху — берём его у страницы. */
  const [current, setCurrent] = useState<Locale>(initial ?? "ru");
  useEffect(() => {
    if (initial) return;
    setCurrent(document.documentElement.lang === "en" ? "en" : "ru");
  }, [initial]);

  const choose = async (language: Locale) => {
    if (language === current || busy) return;
    setBusy(language);
    setError("");
    try {
      const response = await fetch("/api/profile/language", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language }),
      });
      if (!response.ok) throw new Error();
      window.location.reload();
    } catch {
      setError("Не удалось сменить язык.");
      setBusy(null);
    }
  };

  return (
    <div className={compact ? "language-switch is-compact" : "language-switch"}>
      <div className="language-switch-options" role="group" aria-label="Выбор языка сайта" aria-busy={Boolean(busy)}>
        {(compact ? [["ru", "RU"], ["en", "EN"]] as const : [["ru", "РУССКИЙ"], ["en", "ENGLISH"]] as const).map(([value, label]) => (
          <button
            type="button"
            key={value}
            className={value === current ? "is-active" : undefined}
            aria-pressed={value === current}
            aria-label={value === "ru" ? "Русский" : "English"}
            title={value === "ru" ? "Русский" : "English"}
            lang={value}
            translate="no"
            disabled={Boolean(busy)}
            onClick={() => void choose(value)}
          >
            <span>{label}</span>{busy === value ? <span aria-hidden="true">…</span> : null}
          </button>
        ))}
      </div>
      {error ? <p className="form-message error-message" role="alert">{error}</p> : null}
    </div>
  );
}
