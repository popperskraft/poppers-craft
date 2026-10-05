"use client";

import { useEffect } from "react";

type ErrorPayload = {
  category: string;
  message: string;
  page?: string;
  method?: string;
  statusCode?: number;
  source?: string;
  stack?: string;
};

const logEndpoint = "/api/error-logs";

export function ErrorMonitor() {
  useEffect(() => {
    const recent = new Map<string, number>();
    const originalFetch = window.fetch.bind(window);

    const report = (payload: ErrorPayload) => {
      const fullPayload = { ...payload, page: payload.page ?? `${window.location.pathname}${window.location.search}` };
      const fingerprint = `${fullPayload.category}|${fullPayload.message}|${fullPayload.page}|${fullPayload.statusCode ?? ""}`;
      const now = Date.now();
      if ((recent.get(fingerprint) ?? 0) > now - 30_000) return;
      recent.set(fingerprint, now);
      if (recent.size > 100) {
        for (const [key, timestamp] of recent) if (timestamp < now - 5 * 60_000) recent.delete(key);
      }
      void originalFetch(logEndpoint, {
        method: "POST",
        credentials: "same-origin",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(fullPayload),
      }).catch(() => undefined);
    };

    const onError = (event: ErrorEvent | Event) => {
      if (event instanceof ErrorEvent) {
        report({
          category: "client",
          message: event.message || "Ошибка JavaScript",
          source: event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : "window.error",
          stack: event.error instanceof Error ? event.error.stack : "",
        });
        return;
      }
      const target = event.target;
      if (target instanceof HTMLImageElement || target instanceof HTMLScriptElement || target instanceof HTMLLinkElement) {
        report({
          category: "resource",
          message: `Не загрузился ресурс: ${target.tagName.toLowerCase()}`,
          source: target instanceof HTMLLinkElement ? target.href : target.src,
        });
      }
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      report({
        category: "promise",
        message: reason instanceof Error ? reason.message : String(reason ?? "Необработанная ошибка Promise"),
        source: "unhandledrejection",
        stack: reason instanceof Error ? reason.stack : "",
      });
    };

    window.fetch = async (...args) => {
      const request = args[0];
      const init = args[1];
      const rawUrl = typeof request === "string" || request instanceof URL ? String(request) : request.url;
      const url = new URL(rawUrl, window.location.href);
      const method = (init?.method ?? (request instanceof Request ? request.method : "GET")).toUpperCase();
      const shouldMonitor = url.origin === window.location.origin && url.pathname !== logEndpoint;
      try {
        const response = await originalFetch(...args);
        if (shouldMonitor && response.status >= 500) {
          report({ category: "api", message: `API вернул ${response.status}`, page: url.pathname, method, statusCode: response.status, source: url.pathname });
        }
        return response;
      } catch (error) {
        if (shouldMonitor) {
          report({
            category: "network",
            message: error instanceof Error ? error.message : "Сетевая ошибка",
            page: url.pathname,
            method,
            source: url.pathname,
            stack: error instanceof Error ? error.stack : "",
          });
        }
        throw error;
      }
    };

    window.addEventListener("error", onError, true);
    window.addEventListener("unhandledrejection", onRejection);
    void originalFetch(logEndpoint, { cache: "no-store", credentials: "same-origin" }).catch(() => undefined);
    return () => {
      window.fetch = originalFetch;
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
