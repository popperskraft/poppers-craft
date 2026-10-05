"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "./authorize.module.css";

/* Явное подтверждение входа в лаунчер: пока игрок сам не нажал кнопку,
   лаунчер ничего не получает. */
export function LauncherConfirm({ request, code, login }: { request: string; code: string; login: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const [error, setError] = useState("");

  const confirm = async () => {
    setState("busy");
    setError("");
    try {
      const response = await fetch("/api/launcher/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request, code }),
      });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? "Не удалось подтвердить вход.");
      setState("done");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Не удалось подтвердить вход.");
      setState("idle");
    }
  };

  return (
    <main className={styles.desktop}>
      <section className={`paint-window ${styles.window}`}>
        <div className="window-bar"><span>launcher_authorize.exe</span></div>
        <div className={styles.body}>
          <span className={styles.eyebrow}>{state === "done" ? "ACCESS_OK" : "POPPERSCRAFT LAUNCHER"}</span>
          {state === "done" ? (
            <>
              <h1>ВХОД ПОДТВЕРЖДЁН</h1>
              <p>Можно закрыть эту вкладку и вернуться в лаунчер.</p>
            </>
          ) : (
            <>
              <h1>ВОЙТИ В ЛАУНЧЕР?</h1>
              <p>Лаунчер на этом компьютере просит войти как <b translate="no">@{login}</b>. Подтверждайте, только если вы сами только что нажали «Войти через сайт» в лаунчере.</p>
              {error ? <p className="form-message error-message">{error}</p> : null}
              <div className={styles.actions}>
                <button type="button" disabled={state === "busy"} onClick={() => void confirm()}>
                  {state === "busy" ? "ПОДТВЕРЖДАЕМ…" : "ПОДТВЕРДИТЬ ВХОД →"}
                </button>
                <Link className={styles.siteLink} href="/">ЭТО НЕ Я</Link>
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
