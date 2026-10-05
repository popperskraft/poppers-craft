"use client";

import Link from "next/link";
import { useState } from "react";
import { LoginModal } from "@/app/LoginModal";

export function WhitelistAccess({ target, signedIn }: { target: string; signedIn: boolean }) {
  const [loginOpen, setLoginOpen] = useState(false);
  return (
    <main className="admin-shell player-whitelist-page">
      <header className="admin-header">
        <div><p>POPPERSCRAFT COMMUNITY VOTE</p><h1>ВАЙТЛИСТ</h1></div>
        <div className="admin-header-links"><Link href="/">НА ГЛАВНУЮ</Link></div>
      </header>
      <section className="empty-applications">
        <p>{signedIn ? "Читать анкеты и голосовать могут принятые на сервер игроки и администраторы." : "Войди в аккаунт игрока, чтобы прочитать анкету и проголосовать. После входа откроется эта же страница."}</p>
        {signedIn ? <Link href="/profile">ОТКРЫТЬ ПРОФИЛЬ</Link> : <button className="header-login-button" type="button" onClick={() => setLoginOpen(true)}>ВОЙТИ И ОТКРЫТЬ АНКЕТУ →</button>}
      </section>
      {!signedIn ? <LoginModal open={loginOpen} onClose={() => setLoginOpen(false)} successRedirect={target} /> : null}
    </main>
  );
}
