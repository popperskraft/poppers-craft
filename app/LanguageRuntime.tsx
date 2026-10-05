"use client";

import { useEffect } from "react";
import type { Locale } from "@/lib/i18n/config";
import { createTranslator, type Translator } from "@/lib/i18n/translate";

/* Английская версия сайта.

   Сервер всегда отдаёт страницу по-русски, а этот компонент после
   загрузки переводит её на месте по словарю lib/i18n/en.ts: текст,
   подсказки (title), подписи для экранных дикторов (aria-label),
   placeholder, alt, заголовок вкладки и системные окна alert/confirm.

   Всё, что появляется позже — ответы сервера, открытые окна, переходы
   между страницами, — ловит MutationObserver. Его обработчик выполняется
   до следующей отрисовки кадра, поэтому русский текст не мелькает.

   Перевод включается после гидратации React: если поменять текст раньше,
   React увидел бы расхождение с серверной разметкой и перерисовал бы всё
   заново. До первого прохода страница скрыта классом i18n-pending на
   <html>; предохранитель в <head> снимает его через 2,5 секунды, даже если
   скрипт не загрузится.

   Текст, которого нет в словаре (записи обновлений, посты, статьи и
   профили из базы), переводится машинно через /api/i18n/translate: пачками
   до 40 фраз, с кэшем на сервере и в localStorage — повторно одна и та же
   фраза не переводится. В управлении (/admin) машинный перевод выключен:
   там личные данные игроков, их незачем отправлять во внешний сервис.

   Не переводятся: чат с Попперсом (по договорённости он остаётся на
   русском), поля ввода, скрипты и всё внутри [translate="no"]. */

const CYRILLIC = /[А-Яа-яЁё]/;
const ATTRIBUTES = ["title", "aria-label", "aria-roledescription", "placeholder", "alt"];
const SKIP = 'script, style, noscript, textarea, [contenteditable="true"], [translate="no"], .poppers-assistant-panel';
const ATTRIBUTE_SKIP = 'script, style, noscript, [contenteditable="true"], [translate="no"], .poppers-assistant-panel';
const MACHINE_STORAGE = "popperscraft-i18n-machine";
const MACHINE_BATCH = 40;
const MACHINE_MAX_TEXT = 2_000;
const MACHINE_CACHE_LIMIT = 800;

function loadMachineCache() {
  try {
    const stored = JSON.parse(window.localStorage.getItem(MACHINE_STORAGE) ?? "{}") as Record<string, string>;
    return new Map(Object.entries(stored).filter(([, value]) => typeof value === "string"));
  } catch {
    return new Map<string, string>();
  }
}

function saveMachineCache(cache: Map<string, string>) {
  try {
    const entries = [...cache.entries()].slice(-MACHINE_CACHE_LIMIT);
    window.localStorage.setItem(MACHINE_STORAGE, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Без localStorage перевод просто придёт с сервера ещё раз.
  }
}

declare global {
  interface Window {
    /* Фразы без перевода — для поиска пропусков в консоли браузера. */
    __i18nMissed?: Set<string>;
  }
}

function skipped(element: Element | null) {
  return Boolean(element?.closest(SKIP));
}

export function LanguageRuntime({ locale }: { locale: Locale }) {
  useEffect(() => {
    if (locale !== "en") return;
    const root = document.documentElement;
    let observer: MutationObserver | null = null;
    let cancelled = false;
    const missed = (window.__i18nMissed ??= new Set<string>());
    const originals = { alert: window.alert, confirm: window.confirm, prompt: window.prompt };

    /* Машинный перевод: очередь фраз без словарного перевода. */
    const machineCache = loadMachineCache();
    const machineQueue = new Map<string, Set<Text>>();
    const machineAllowed = !window.location.pathname.startsWith("/admin");
    let machineTimer = 0;
    let machineBroken = false;

    const applyMachine = (node: Text, original: string, translation: string) => {
      const value = node.nodeValue ?? "";
      if (!node.isConnected || value.trim() !== original) return;
      const lead = value.match(/^\s*/)?.[0] ?? "";
      const trail = value.match(/\s*$/)?.[0] ?? "";
      node.nodeValue = `${lead}${translation}${trail}`;
    };

    const flushMachine = async () => {
      machineTimer = 0;
      if (machineBroken || !machineQueue.size) return;
      const batch = [...machineQueue.keys()].slice(0, MACHINE_BATCH);
      const nodes = new Map(batch.map((text) => [text, machineQueue.get(text) ?? new Set<Text>()]));
      batch.forEach((text) => machineQueue.delete(text));
      try {
        const response = await fetch("/api/i18n/translate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ texts: batch }),
        });
        const result = response.ok ? await response.json() : null;
        if (!result || result.failed) machineBroken = true;
        const translations = (result?.translations ?? {}) as Record<string, string>;
        for (const [text, translation] of Object.entries(translations)) {
          machineCache.set(text, translation);
          nodes.get(text)?.forEach((node) => applyMachine(node, text, translation));
        }
        saveMachineCache(machineCache);
      } catch {
        machineBroken = true;
      }
      if (machineQueue.size && !machineBroken) machineTimer = window.setTimeout(() => void flushMachine(), 400);
    };

    const queueMachine = (node: Text) => {
      if (!machineAllowed || machineBroken) return;
      const original = (node.nodeValue ?? "").trim();
      if (!original || original.length > MACHINE_MAX_TEXT) return;
      const cached = machineCache.get(original);
      if (cached) {
        applyMachine(node, original, cached);
        return;
      }
      const waiting = machineQueue.get(original) ?? new Set<Text>();
      waiting.add(node);
      machineQueue.set(original, waiting);
      if (!machineTimer) machineTimer = window.setTimeout(() => void flushMachine(), 300);
    };

    const translateValue = (translate: Translator, value: string) => {
      const result = translate(value);
      if (result === null && CYRILLIC.test(value)) missed.add(value.replace(/\s+/g, " ").trim());
      return result;
    };

    const translateText = (translate: Translator, node: Text) => {
      const value = node.nodeValue;
      if (!value || !CYRILLIC.test(value) || skipped(node.parentElement)) return;
      const lead = value.match(/^\s*/)?.[0] ?? "";
      const trail = value.match(/\s*$/)?.[0] ?? "";
      const result = translateValue(translate, value);
      if (result !== null) node.nodeValue = `${lead}${result}${trail}`;
      else queueMachine(node);
    };

    const translateAttributes = (translate: Translator, element: Element) => {
      // Translate textarea hints, never the user's entered value or text nodes.
      if (element.closest(ATTRIBUTE_SKIP)) return;
      for (const name of ATTRIBUTES) {
        const value = element.getAttribute(name);
        if (!value || !CYRILLIC.test(value)) continue;
        const result = translateValue(translate, value);
        if (result !== null) element.setAttribute(name, result);
      }
      /* Надпись на кнопке-поле ввода хранится в value. */
      if (element instanceof HTMLInputElement && ["button", "submit", "reset"].includes(element.type) && CYRILLIC.test(element.value)) {
        const result = translateValue(translate, element.value);
        if (result !== null) element.value = result;
      }
    };

    const translateTree = (translate: Translator, start: Node) => {
      if (start.nodeType === Node.TEXT_NODE) {
        translateText(translate, start as Text);
        return;
      }
      if (!(start instanceof Element)) return;
      if (start instanceof HTMLTextAreaElement) translateAttributes(translate, start);
      if (skipped(start)) return;
      translateAttributes(translate, start);
      const walker = document.createTreeWalker(start, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
          if (node instanceof HTMLTextAreaElement) translateAttributes(translate, node);
          return node instanceof Element && node.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
        },
      });
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.nodeType === Node.TEXT_NODE) translateText(translate, node as Text);
        else translateAttributes(translate, node as Element);
      }
    };

    void import("@/lib/i18n/en").then(({ EN_PHRASES }) => {
      if (cancelled) return;
      const translate = createTranslator(EN_PHRASES);

      window.alert = (message?: unknown) => originals.alert.call(window, typeof message === "string" ? translate(message) ?? message : message);
      window.confirm = (message?: string) => originals.confirm.call(window, typeof message === "string" ? translate(message) ?? message : message);
      window.prompt = (message?: string, fallback?: string) =>
        originals.prompt.call(window, typeof message === "string" ? translate(message) ?? message : message, fallback);

      translateTree(translate, document.head);
      translateTree(translate, document.body);
      root.classList.remove("i18n-pending");

      observer = new MutationObserver((records) => {
        for (const record of records) {
          if (record.type === "characterData") translateText(translate, record.target as Text);
          else if (record.type === "attributes") translateAttributes(translate, record.target as Element);
          else record.addedNodes.forEach((node) => translateTree(translate, node));
        }
      });
      observer.observe(root, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: [...ATTRIBUTES, "value"],
      });
    }).catch(() => {
      root.classList.remove("i18n-pending");
    });

    return () => {
      cancelled = true;
      window.clearTimeout(machineTimer);
      observer?.disconnect();
      window.alert = originals.alert;
      window.confirm = originals.confirm;
      window.prompt = originals.prompt;
    };
  }, [locale]);

  return null;
}
