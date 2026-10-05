"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

type CheckState = "idle" | "checking" | "done" | "clean" | "error";

function canCheck(element: EventTarget | null): element is HTMLTextAreaElement {
  return element instanceof HTMLTextAreaElement && !element.disabled && !element.readOnly && element.dataset.grammar !== "off";
}

export function GrammarAssistant() {
  const [field, setField] = useState<HTMLTextAreaElement | null>(null);
  const [state, setState] = useState<CheckState>("idle");
  const [, redraw] = useState(0);

  useEffect(() => {
    const focusIn = (event: FocusEvent) => {
      if ((event.target as Element | null)?.closest?.(".grammar-check-button")) return;
      setField(canCheck(event.target) ? event.target : null);
      setState("idle");
    };
    const reposition = () => redraw((value) => value + 1);
    document.addEventListener("focusin", focusIn);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      document.removeEventListener("focusin", focusIn);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, []);

  /* Кнопка привязана к конкретному текстовому полю и раньше исчезала только
     тогда, когда фокус переходил на другой элемент. Если поле пропадало
     вместе со своим окном, события focusin не было, состояние не менялось,
     React не перерисовывал компонент — и кнопка оставалась висеть поверх
     страницы. Поэтому за полем нужно следить отдельно.

     Проверяются три случая: поле удалили из DOM, поле спрятали не удаляя,
     и фокус ушёл с поля куда-то мимо самой кнопки. */
  useEffect(() => {
    if (!field) return;

    const forget = () => {
      setField(null);
      setState("idle");
    };

    const gone = () => {
      if (!field.isConnected) return true;
      if (typeof field.checkVisibility === "function") return !field.checkVisibility();
      const rect = field.getBoundingClientRect();
      return rect.width === 0 && rect.height === 0;
    };

    const verify = () => {
      if (gone()) forget();
    };

    /* Удаление поля вместе с закрытым окном ловится наблюдателем за DOM. */
    const observer = new MutationObserver(verify);
    observer.observe(document.body, { childList: true, subtree: true });

    /* Скрытие без удаления (display: none у родителя) наблюдателем не ловится,
       поэтому состояние поля дополнительно проверяется по таймеру. */
    const timer = window.setInterval(verify, 500);

    const focusOut = () => {
      window.setTimeout(() => {
        const active = document.activeElement;
        if (active === field) return;
        if (active?.closest?.(".grammar-check-button")) return;
        forget();
      }, 0);
    };
    field.addEventListener("focusout", focusOut);

    return () => {
      observer.disconnect();
      window.clearInterval(timer);
      field.removeEventListener("focusout", focusOut);
    };
  }, [field]);

  async function checkText() {
    if (!field || state === "checking") return;
    const text = field.value.trim();
    if (text.length < 12) {
      setState("clean");
      window.setTimeout(() => setState("idle"), 1400);
      return;
    }
    setState("checking");
    try {
      const response = await fetch("/api/grammar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const result = await response.json();
      if (!response.ok || typeof result.text !== "string") throw new Error("grammar-check-failed");
      const corrected = result.text.trim();
      const limited = field.maxLength > 0 ? corrected.slice(0, field.maxLength) : corrected;
      if (limited === text) {
        setState("clean");
      } else {
        const valueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        valueSetter?.call(field, limited);
        field.dispatchEvent(new Event("input", { bubbles: true }));
        field.dispatchEvent(new Event("change", { bubbles: true }));
        field.focus({ preventScroll: true });
        field.setSelectionRange(limited.length, limited.length);
        setState("done");
      }
    } catch {
      setState("error");
    }
    window.setTimeout(() => setState("idle"), 1900);
  }

  if (!field || !field.isConnected || typeof document === "undefined") return null;
  if (typeof field.checkVisibility === "function" && !field.checkVisibility()) return null;
  const rect = field.getBoundingClientRect();
  /* Нулевой размер означает, что поле скрыто: показывать кнопку не к чему. */
  if (rect.width === 0 && rect.height === 0) return null;
  if (rect.bottom < 0 || rect.top > window.innerHeight || rect.right < 0 || rect.left > window.innerWidth) return null;

  const labels: Record<CheckState, string> = {
    idle: "ИИ",
    checking: "…",
    done: "✓",
    clean: "✓",
    error: "!",
  };
  const accessibleLabels: Record<CheckState, string> = {
    idle: "Проверить текст с помощью ИИ",
    checking: "ИИ проверяет текст",
    done: "ИИ исправил текст",
    clean: "ИИ не нашёл ошибок",
    error: "ИИ не смог проверить текст",
  };

  return createPortal(
    <button
      className={`grammar-check-button is-${state}`}
      type="button"
      style={{ left: Math.max(8, rect.right - 38), top: Math.max(8, rect.top + 8) }}
      onClick={() => void checkText()}
      disabled={state === "checking"}
      title={accessibleLabels[state]}
      aria-label={accessibleLabels[state]}
    >
      {labels[state]}
    </button>,
    document.body,
  );
}
