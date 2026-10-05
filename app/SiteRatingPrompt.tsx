"use client";

import { FormEvent, useEffect, useState } from "react";

/* Опрос показывается один раз на аккаунт и на каждый запуск опроса админами.
   Ключи привязаны и к идентификатору опроса, и к пользователю: новый опрос от
   админов получает новый promptId, поэтому окно появится снова, а на чужом
   аккаунте в том же браузере счётчик свой. */
function seenKey(promptId: string, viewerId: string) {
  return `popperscraft-rating-seen:${promptId}:${viewerId}`;
}

function usageKey(promptId: string, viewerId: string) {
  return `popperscraft-rating-usage:${promptId}:${viewerId}`;
}

/* Сколько секунд пользователь должен провести на сайте, прежде чем его
   попросят оценить. Время накапливается между переходами по страницам и
   считается только когда вкладка активна. */
const REQUIRED_USAGE_SECONDS = 120;
const USAGE_TICK_SECONDS = 5;

export function SiteRatingPrompt({
  initialPromptId,
  viewerId,
}: {
  initialPromptId: string | null;
  viewerId: string | null;
}) {
  const [promptId, setPromptId] = useState(initialPromptId);
  const [open, setOpen] = useState(false);
  const [stars, setStars] = useState(0);
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [storm, setStorm] = useState(false);

  useEffect(() => {
    /* Гостю опрос не показывается вообще. */
    if (!promptId || !viewerId) return;
    if (window.localStorage.getItem(seenKey(promptId, viewerId))) return;

    const readUsage = () => {
      const stored = Number(window.localStorage.getItem(usageKey(promptId, viewerId)));
      return Number.isFinite(stored) && stored > 0 ? stored : 0;
    };

    if (readUsage() >= REQUIRED_USAGE_SECONDS) {
      setOpen(true);
      return;
    }

    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const next = readUsage() + USAGE_TICK_SECONDS;
      window.localStorage.setItem(usageKey(promptId, viewerId), String(next));
      if (next >= REQUIRED_USAGE_SECONDS) {
        window.clearInterval(timer);
        setOpen(true);
      }
    }, USAGE_TICK_SECONDS * 1_000);

    return () => window.clearInterval(timer);
  }, [promptId, viewerId]);

  useEffect(() => {
    /* Гостю опрос не показывается, поэтому и опрашивать сервер незачем. */
    if (!viewerId) return;
    let stopped = false;
    const check = async () => {
      try {
        const response = await fetch("/api/site-state", { cache: "no-store" });
        const result = await response.json();
        const nextId = typeof result.ratingPromptId === "string" ? result.ratingPromptId : null;
        if (!stopped && nextId && nextId !== promptId) setPromptId(nextId);
      } catch {
        // The prompt will be checked again after the next refresh.
      }
    };
    const timer = window.setInterval(() => void check(), 60_000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [promptId, viewerId]);

  const remember = () => {
    if (promptId && viewerId) {
      window.localStorage.setItem(seenKey(promptId, viewerId), new Date().toISOString());
    }
  };

  const close = () => {
    remember();
    setOpen(false);
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!promptId || stars < 1 || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/rating", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stars, feedback, promptId, pageUrl: window.location.pathname }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Не удалось отправить оценку.");
      remember();
      if (stars <= 2) {
        setOpen(false);
        setStorm(true);
        document.body.classList.add("site-rating-low");
        window.setTimeout(() => {
          document.body.classList.remove("site-rating-low");
          setStorm(false);
        }, 4_000);
      } else {
        setMessage("Спасибо. Оценка сохранена.");
        window.setTimeout(() => setOpen(false), 1_200);
      }
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : "Не удалось отправить оценку.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {open ? (
        <div className="rating-prompt-backdrop" role="presentation">
          <section className="paint-window rating-prompt" role="dialog" aria-modal="true" aria-labelledby="rating-title">
            <div className="window-bar"><span>rate_popperscraft.exe</span><button type="button" onClick={close} aria-label="Закрыть">×</button></div>
            <form onSubmit={submit}>
              <p className="kicker">КОРОТКИЙ ОПРОС</p>
              <h2 id="rating-title">ОЦЕНИТЕ НАС</h2>
              <p>Как вам сайт сейчас?</p>
              <fieldset className="rating-stars">
                <legend>Оценка от 1 до 5</legend>
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    type="button"
                    className={value <= stars ? "active" : ""}
                    aria-label={`${value} из 5`}
                    aria-pressed={stars === value}
                    onClick={() => setStars(value)}
                    key={value}
                  >★</button>
                ))}
              </fieldset>
              <label>ЧТО НЕ ТАК?<textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} maxLength={800} rows={5} placeholder="Можно написать коротко. Поле необязательное." /></label>
              {message ? <p className="form-message" role="status">{message}</p> : null}
              <div className="rating-actions"><button type="button" onClick={close}>НЕ СЕЙЧАС</button><button type="submit" disabled={!stars || busy}>{busy ? "ОТПРАВЛЯЕМ…" : "ОТПРАВИТЬ"}</button></div>
            </form>
          </section>
        </div>
      ) : null}
      {storm ? (
        <div className="rating-storm" aria-live="polite">
          <i className="rating-cloud cloud-one" /><i className="rating-cloud cloud-two" /><i className="rating-cloud cloud-three" />
          <div className="rating-rain" aria-hidden="true" />
          <strong>МЫ ПОСТАРАЕМСЯ</strong>
        </div>
      ) : null}
    </>
  );
}
