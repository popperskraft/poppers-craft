"use client";

import { resetTrail } from "@/lib/navigation-trail";

export function LogoutButton({ className = "member-logout" }: { className?: string }) {
  const logout = async () => {
    await fetch("/api/logout", { method: "POST" });
    /* Страницы аккаунта после выхода закрыты — «Назад» туда не ведёт. */
    resetTrail();
    window.location.href = "/";
  };
  return (
    <button className={className} type="button" onClick={logout}>
      ВЫЙТИ
    </button>
  );
}
