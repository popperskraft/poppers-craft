"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loginReturnTarget } from "@/lib/login-return";

type TelegramLoginResult = {
  id_token?: string;
  error?: string;
};

type TelegramLoginOptions = {
  client_id: number;
  scope: ["profile"];
  lang: string;
  nonce: string;
  redirect_uri: string;
};

declare global {
  interface Window {
    Telegram?: {
      Login: {
        auth: (
          options: TelegramLoginOptions,
          callback: (result: TelegramLoginResult) => void,
        ) => void;
      };
    };
  }
}

// Keep the SDK URL versioned: browsers may otherwise reuse an older Telegram
// script that opened the OAuth popup without the now-required redirect_uri.
const sdkUrl = "/api/auth/telegram/sdk?v=20260822-1";
let telegramSdkPromise: Promise<void> | null = null;

function loadTelegramSdk() {
  if (window.Telegram?.Login) return Promise.resolve();
  if (telegramSdkPromise) return telegramSdkPromise;

  telegramSdkPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${sdkUrl}"]`);
    existing?.remove();

    const script = document.createElement("script");
    script.src = sdkUrl;
    script.async = true;
    script.onload = () => {
      if (window.Telegram?.Login) resolve();
      else {
        telegramSdkPromise = null;
        script.remove();
        reject(new Error("Telegram SDK did not initialize"));
      }
    };
    script.onerror = () => {
      telegramSdkPromise = null;
      script.remove();
      reject(new Error("Telegram SDK failed to load"));
    };
    document.head.appendChild(script);
  });

  return telegramSdkPromise;
}

async function requestNonce() {
  const response = await fetch("/api/auth/telegram/nonce", {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error("Telegram nonce request failed");
  const data = (await response.json()) as { nonce?: string };
  if (!data.nonce) throw new Error("Telegram nonce is missing");
  return data.nonce;
}

export function TelegramLoginButton({
  mode = "login",
  initiallyLinked = false,
  successRedirect,
}: {
  mode?: "login" | "link";
  initiallyLinked?: boolean;
  successRedirect?: string;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [linked, setLinked] = useState(initiallyLinked);
  const nonceRef = useRef<{ value: string; createdAt: number } | null>(null);
  const mountedRef = useRef(true);

  const prepareLogin = useCallback(async () => {
    const [nonce] = await Promise.all([requestNonce(), loadTelegramSdk()]);
    nonceRef.current = { value: nonce, createdAt: Date.now() };
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void prepareLogin().catch(() => {
      // Повторим при нажатии, если Telegram или сеть ещё не были готовы.
    });
    return () => {
      mountedRef.current = false;
    };
  }, [prepareLogin]);

  const startLogin = async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");

    try {
      const clientId = Number(process.env.NEXT_PUBLIC_TELEGRAM_CLIENT_ID);
      if (!Number.isSafeInteger(clientId) || clientId <= 0) {
        throw new Error("Telegram client ID is missing");
      }

      const cached = nonceRef.current;
      if (!cached || Date.now() - cached.createdAt > 240_000) await prepareLogin();
      else await loadTelegramSdk();

      const nonce = nonceRef.current?.value;
      const telegramLogin = window.Telegram?.Login;
      if (!nonce || !telegramLogin) throw new Error("Telegram SDK is unavailable");

      telegramLogin.auth(
        {
          client_id: clientId,
          scope: ["profile"],
          lang: document.documentElement.lang === "en" ? "en" : "ru",
          nonce,
          redirect_uri: `${window.location.origin}${window.location.pathname}`,
        },
        async (result) => {
          if (!mountedRef.current) return;
          nonceRef.current = null;

          if (result.error || !result.id_token) {
            setBusy(false);
            setMessage(result.error ? `Telegram: ${result.error}` : "Вход через Telegram отменён.");
            void prepareLogin().catch(() => undefined);
            return;
          }

          try {
            const response = await fetch("/api/auth/telegram", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "same-origin",
              body: JSON.stringify({ idToken: result.id_token, mode }),
            });
            const data = await response.json();
            if (!response.ok) {
              setMessage(data.error ?? "Не удалось войти через Telegram.");
              return;
            }
            if (mode === "login") window.location.href = loginReturnTarget(data.redirectTo, successRedirect);
            else {
              setLinked(true);
              setMessage("Telegram привязан к аккаунту.");
            }
          } catch {
            setMessage("Telegram временно недоступен.");
          } finally {
            if (mountedRef.current) {
              setBusy(false);
              void prepareLogin().catch(() => undefined);
            }
          }
        },
      );
    } catch {
      setBusy(false);
      setMessage("Не удалось открыть Telegram. Попробуйте ещё раз.");
    }
  };

  const unlinkTelegram = async () => {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/auth/telegram", {
        method: "DELETE",
        credentials: "same-origin",
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "Не удалось отвязать Telegram.");
        return;
      }
      setLinked(false);
      setMessage("Старый Telegram отвязан. Теперь можно привязать новый.");
    } catch {
      setMessage("Telegram временно недоступен.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="telegram-login-control" aria-busy={busy}>
      {mode === "link" && linked ? (
        <>
          <span className="telegram-linked-status">TELEGRAM ПРИВЯЗАН</span>
          <button type="button" onClick={unlinkTelegram} disabled={busy}>
            {busy ? "ОТВЯЗЫВАЕМ…" : "ОТВЯЗАТЬ TELEGRAM"}
          </button>
        </>
      ) : (
        <button type="button" onClick={startLogin} disabled={busy}>
          {busy ? "ОТКРЫВАЕМ TELEGRAM…" : mode === "link" ? "ПРИВЯЗАТЬ TELEGRAM" : "ВОЙТИ ЧЕРЕЗ TELEGRAM"}
        </button>
      )}
      {message ? <small>{message}</small> : null}
    </div>
  );
}
