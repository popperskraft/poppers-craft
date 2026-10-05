"use client";

import { useState } from "react";
import Link from "next/link";
import { LoginModal } from "@/app/LoginModal";
import styles from "./authorize.module.css";

export function LauncherAuthorizeClient({ returnTo }: { returnTo: string }) {
  const [open, setOpen] = useState(true);

  return (
    <main className={styles.desktop}>
      <section className={`paint-window ${styles.window}`}>
        <div className="window-bar"><span>launcher_authorize.exe</span></div>
        <div className={styles.body}>
          <span className={styles.eyebrow}>POPPERSCRAFT LAUNCHER</span>
          <h1>ВХОД ЧЕРЕЗ САЙТ</h1>
          <p>Войдите в аккаунт PoppersCraft. После успешного входа эта страница сама передаст подтверждение лаунчеру.</p>
          {/* После успешного входа окно закрывается и подтверждение уходит
              лаунчеру, а страница остаётся пустой. Эта ссылка даёт из неё
              выйти на сайт, а не смотреть в заглушку. */}
          <div className={styles.actions}>
            <button type="button" onClick={() => setOpen(true)}>ВОЙТИ НА САЙТЕ →</button>
            <Link className={styles.siteLink} href="/">ПЕРЕЙТИ НА САЙТ →</Link>
          </div>
          <small>Пароль остаётся на сайте и не передаётся лаунчеру.</small>
        </div>
      </section>
      <LoginModal open={open} onClose={() => setOpen(false)} successRedirect={returnTo} />
    </main>
  );
}
