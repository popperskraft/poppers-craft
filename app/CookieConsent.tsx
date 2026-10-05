"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { MinecraftIcon } from "./MinecraftIcon";

const consentCookie = "popperscraft_cookie_consent";
const subscribeToMount = () => () => undefined;

function hasConsent() {
  return document.cookie
    .split(";")
    .some((cookie) => cookie.trim() === `${consentCookie}=accepted`);
}

export function CookieConsent() {
  const pathname = usePathname();
  const mounted = useSyncExternalStore(subscribeToMount, () => true, () => false);
  const [acceptedNow, setAcceptedNow] = useState(false);
  const visible = mounted && pathname !== "/cookies" && !acceptedNow && !hasConsent();

  if (!visible || pathname === "/cookies") return null;

  const accept = () => {
    document.cookie = `${consentCookie}=accepted; Max-Age=31536000; Path=/; SameSite=Lax; Secure`;
    setAcceptedNow(true);
  };

  const leave = () => {
    window.location.replace("https://www.minecraft.net/ru-ru");
  };

  return (
    <div className="cookie-consent-backdrop">
      <section
        className="paint-window cookie-consent-window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cookie-consent-title"
      >
        <div className="window-bar">
          <span><MinecraftIcon name="cookie" size="sm" /> COOKIE_NOTICE.TXT</span>
        </div>
        <div className="cookie-consent-content">
          <span className="cookie-consent-item" aria-hidden="true">●</span>
          <h2 id="cookie-consent-title">МЫ ИСПОЛЬЗУЕМ<br />ФАЙЛЫ COOKIE</h2>
          <p>
            Cookie нужны, чтобы вход и Telegram работали нормально. Узнать{" "}
            <Link href="/cookies">больше</Link>.
          </p>
          <div className="cookie-consent-actions">
            <button type="button" onClick={accept}>ПРИНЯТЬ</button>
            <button type="button" onClick={leave}>ПОКИНУТЬ САЙТ</button>
          </div>
        </div>
        <div className="status-bar"><span>COOKIE_REQUIRED</span><span>POPPERSCRAFT</span></div>
      </section>
    </div>
  );
}
